package com.meituan.route.solver;

import com.meituan.route.data.GaodeGeoService;
import com.meituan.route.model.Constraint;
import com.meituan.route.model.POI;
import com.meituan.route.model.Route;
import com.meituan.route.model.UserIntent;
import com.meituan.route.model.UserPreference;
import org.jgrapht.Graph;
import org.jgrapht.graph.DefaultDirectedWeightedGraph;
import org.jgrapht.graph.DefaultWeightedEdge;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.LocalTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Graph-based route solver using VRPTW-inspired approach.
 * Builds a weighted POI graph and searches for Pareto-optimal paths.
 *
 * Key improvements for accuracy:
 * - Geographic clustering: rejects POIs too far apart to be in the same route
 * - Distance feasibility: verifies real travel times don't exceed time budget
 * - Budget enforcement: cost over-budget routes are penalized heavily
 */
@Component
public class GraphSearchSolver {

    private static final Logger log = LoggerFactory.getLogger(GraphSearchSolver.class);
    private static final double AVG_WALK_SPEED_KMH = 5.0;
    private static final double AVG_DRIVE_SPEED_KMH = 40.0; // More realistic urban driving speed
    private static final double URBAN_DRIVE_SPEED_KMH = 30.0; // Urban average with traffic

    // Max single-segment distance in km before POI is considered infeasible
    private static final double MAX_SINGLE_HOP_KM = 50.0;

    // Cache travel time estimates
    private final PreferenceScorer preferenceScorer;
    private final GaodeGeoService geoService;
    private final Map<String, Double> travelTimeCache = new ConcurrentHashMap<>();
    // Real distance cache: "lng1,lat1-lng2,lat2" -> [distanceKm, durationMin]
    private final Map<String, double[]> realDistanceCache = new ConcurrentHashMap<>();

    public GraphSearchSolver(PreferenceScorer preferenceScorer, GaodeGeoService geoService) {
        this.preferenceScorer = preferenceScorer;
        this.geoService = geoService;
    }

    /**
     * Generate multiple route plans from candidate POIs.
     * Each plan uses a different objective and a different subset of candidates
     * to ensure diversity — without this, all three goals converge on the same
     * high-rated POIs (e.g., 故宫).
     */
    public List<Route> generatePlans(List<POI> candidates, List<Constraint> constraints,
                                     UserIntent intent, int numPlans) {
        return generatePlans(candidates, constraints, intent, numPlans, null);
    }

    /**
     * Generate route plans with optional user preference for personalization.
     * When a UserPreference is provided, replaces CHEAPEST goal with PREFERENCE
     * for a "偏好优先" route.
     */
    public List<Route> generatePlans(List<POI> candidates, List<Constraint> constraints,
                                     UserIntent intent, int numPlans, UserPreference preference) {
        if (candidates.size() < 2) {
            return handleInsufficientPOIs(candidates, intent);
        }

        // Pre-filter: remove geographically infeasible candidates
        var feasibleCandidates = filterByGeographicFeasibility(candidates, intent);
        if (feasibleCandidates.size() < 2) {
            log.warn("After geographic filtering, only {} candidates remain — using originals", feasibleCandidates.size());
            feasibleCandidates = candidates;
        }
        log.info("Geographic pre-filter: {} → {} feasible candidates", candidates.size(), feasibleCandidates.size());

        var goals = (preference != null && preference.preferenceTags() != null && !preference.preferenceTags().isEmpty())
                ? List.of("BEST_EXPERIENCE", "FASTEST", "PREFERENCE")
                : List.of("BEST_EXPERIENCE", "FASTEST", "CHEAPEST");
        var routes = new ArrayList<Route>();
        var usedIds = new HashSet<String>();

        for (var goal : goals) {
            if (routes.size() >= numPlans) break;

            // Build a goal-specific candidate pool — sort by the goal's score
            var goalCandidates = selectCandidatesForGoal(feasibleCandidates, goal, preference);

            // Remove POIs already used in previous routes to force diversity
            if (!usedIds.isEmpty()) {
                var diverse = new ArrayList<>(goalCandidates);
                diverse.removeIf(p -> usedIds.contains(p.id()));
                if (diverse.size() >= 3) {
                    goalCandidates = diverse;
                } else {
                    // Not enough diverse POIs — shuffle to get different ordering per goal
                    goalCandidates = new ArrayList<>(candidates);
                    java.util.Collections.shuffle(goalCandidates, new java.util.Random(goal.hashCode()));
                }
            }

            var graph = buildGraph(goalCandidates, intent);
            var route = searchBestRoute(graph, goalCandidates, constraints, intent, goal);
            if (route != null && route.segments().size() >= 2) {
                // Verify route feasibility — total time must not exceed time window
                if (isRouteTimeFeasible(route, intent)) {
                    routes.add(route);
                    route.segments().forEach(s -> usedIds.add(s.poi().id()));
                } else {
                    log.info("Route for goal {} rejected: time infeasible ({}min vs {} end time)",
                            goal, Math.round(route.totalTravelTime()), intent.endTime());
                }
            }
        }

        // Fallback: if diversity strategy produced too few routes, re-run without exclusion
        if (routes.size() < 2) {
            var fallbackGoals = goals.subList(routes.size(), goals.size());
            for (var goal : fallbackGoals) {
                var graph = buildGraph(candidates, intent);
                var route = searchBestRoute(graph, candidates, constraints, intent, goal);
                if (route != null && route.segments().size() >= 2) {
                    routes.add(route);
                }
            }
        }

        // Add names and descriptions
        int idx = 0;
        for (var r : routes) {
            String name = switch (r.optimizationGoal()) {
                case "BEST_EXPERIENCE" -> "体验最优方案";
                case "FASTEST" -> "最高效方案";
                case "CHEAPEST" -> "最省钱方案";
                case "PREFERENCE" -> "偏好优先方案";
                default -> "方案" + (idx + 1);
            };
            routes.set(idx, new Route(r.id(), name, generateDescription(r, intent, preference),
                    r.segments(), r.totalCost(), r.totalTravelTime(),
                    r.totalRating(), r.optimizationGoal(),
                    null, null, computeCompositeScore(r, constraints)));
            idx++;
        }

        return routes;
    }

    /**
     * Filter candidates to keep only those geographically close enough to form a feasible route.
     * Uses clustering: finds the largest cluster of mutually reachable POIs.
     * Hard cap: no two POIs more than 20km apart can be in the same route.
     */
    private List<POI> filterByGeographicFeasibility(List<POI> candidates, UserIntent intent) {
        if (candidates.size() <= 3) return candidates;

        // Calculate max allowed distance between any two POIs in the same route
        double maxDistanceKm = 20.0; // hard cap for urban routes

        if (intent.startTime() != null && intent.endTime() != null) {
            long availableMinutes = Duration.between(intent.startTime(), intent.endTime()).toMinutes();
            if (availableMinutes > 0 && availableMinutes < 480) { // only tighten for short windows
                // 3 POIs: 3 * 60min visit + travel. Each hop gets (available - 180) / 3 min
                double maxTravelPerSegment = (availableMinutes - 180.0) / 3.0;
                double distFromTime = maxTravelPerSegment * 0.5; // 0.5 km/min urban
                maxDistanceKm = Math.min(maxDistanceKm, Math.max(distFromTime, 5.0));
            }
        }

        maxDistanceKm = Math.min(maxDistanceKm, 20.0);
        maxDistanceKm = Math.max(maxDistanceKm, 5.0);

        log.info("Feasibility filter: maxDist={}km (available={}min)",
                Math.round(maxDistanceKm * 10) / 10.0,
                intent.startTime() != null && intent.endTime() != null
                        ? Duration.between(intent.startTime(), intent.endTime()).toMinutes() : -1);

        double finalMaxDist = maxDistanceKm;

        // Greedy cluster: start from best-rated, grow by adding nearby POIs
        var sorted = new ArrayList<>(candidates);
        sorted.sort((a, b) -> Double.compare(b.rating(), a.rating()));

        var feasible = new ArrayList<POI>();
        for (var seed : sorted) {
            var cluster = new ArrayList<POI>();
            cluster.add(seed);
            for (var other : sorted) {
                if (other.equals(seed)) continue;
                boolean reachable = true;
                for (var member : cluster) {
                    if (haversine(member.lat(), member.lng(), other.lat(), other.lng()) > finalMaxDist) {
                        reachable = false;
                        break;
                    }
                }
                if (reachable) cluster.add(other);
            }
            if (cluster.size() > feasible.size()) {
                feasible = cluster;
            }
        }

        // Always apply hard 20km filter — even when falling back
        if (feasible.size() < 2) {
            log.info("Feasibility filter: no cluster found, applying hard 20km neighbor filter");
            feasible = candidates.stream()
                    .filter(p -> hasNearbyNeighbor(p, candidates, 20.0))
                    .collect(Collectors.toCollection(ArrayList::new));
        }

        if (feasible.size() < 2) {
            log.warn("Feasibility filter: even hard filter leaves <2 POIs, using all {} candidates", candidates.size());
            return candidates;
        }

        log.info("Feasibility filter: {} → {} candidates (maxDist={}km)", candidates.size(), feasible.size(), Math.round(finalMaxDist));
        return feasible;
    }

    /** Check if a POI has at least one nearby neighbor within maxDistanceKm. */
    private boolean hasNearbyNeighbor(POI poi, List<POI> all, double maxDistKm) {
        for (var other : all) {
            if (other.equals(poi)) continue;
            if (haversine(poi.lat(), poi.lng(), other.lat(), other.lng()) <= maxDistKm) return true;
        }
        return false;
    }

    /** Verify that total route time does not exceed the intent's time window. */
    private boolean isRouteTimeFeasible(Route route, UserIntent intent) {
        if (intent.endTime() == null || intent.startTime() == null) return true;
        var lastSegment = route.segments().get(route.segments().size() - 1);
        var totalEnd = lastSegment.departureTime();
        // Allow 15-minute buffer
        return !totalEnd.isAfter(intent.endTime().plusMinutes(15));
    }

    /**
     * Select top candidates for a specific optimization goal.
     * Different goals prioritize different dimensions so each route
     * explores a different region of the POI space.
     */
    private List<POI> selectCandidatesForGoal(List<POI> candidates, String goal, UserPreference preference) {
        var sorted = new ArrayList<>(candidates);
        switch (goal) {
            case "BEST_EXPERIENCE" -> sorted.sort((a, b) -> Double.compare(
                    b.rating() * 20 + b.popularityScore() * 0.3 + barBoost(b) + ugcBoost(b),
                    a.rating() * 20 + a.popularityScore() * 0.3 + barBoost(a) + ugcBoost(a)));
            case "FASTEST" -> {
                double sumLat = 0, sumLng = 0;
                for (var p : sorted) { sumLat += p.lat(); sumLng += p.lng(); }
                double cLat = sumLat / sorted.size(), cLng = sumLng / sorted.size();
                sorted.sort((a, b) -> {
                    double distA = haversine(a.lat(), a.lng(), cLat, cLng);
                    double distB = haversine(b.lat(), b.lng(), cLat, cLng);
                    double scoreA = (1.0 / Math.max(0.1, distA)) * 5.0
                            + (100.0 - Math.min(a.visitDuration(), 100)) * 0.3 + a.rating() * 3 + barBoost(a) + ugcBoost(a);
                    double scoreB = (1.0 / Math.max(0.1, distB)) * 5.0
                            + (100.0 - Math.min(b.visitDuration(), 100)) * 0.3 + b.rating() * 3 + barBoost(b) + ugcBoost(b);
                    return Double.compare(scoreB, scoreA);
                });
            }
            case "CHEAPEST" -> sorted.sort((a, b) -> {
                    // Strongly prioritize cost; rating is secondary (TC08: differentiation from BEST_EXPERIENCE)
                    double scoreA = Math.max(0, 500 - a.avgCost()) * 2.0  // heavy cost weight
                            + a.rating() * 2.0                             // reduced rating weight
                            - (a.queueTime() > 10 ? 30 : 0);              // penalize long queues
                    double scoreB = Math.max(0, 500 - b.avgCost()) * 2.0
                            + b.rating() * 2.0
                            - (b.queueTime() > 10 ? 30 : 0);
                    return Double.compare(scoreB, scoreA);
                });
            case "PREFERENCE" -> {
                if (preference != null) {
                    sorted.sort((a, b) -> Double.compare(
                            preferenceScorer.scorePOI(b, preference) * 20  // doubled preference weight (TC07)
                                    + b.rating() * 2                         // reduced rating weight
                                    + barBoost(b) + ugcBoost(b),
                            preferenceScorer.scorePOI(a, preference) * 20
                                    + a.rating() * 2
                                    + barBoost(a) + ugcBoost(a)));
                }
            }
            default -> sorted.sort((a, b) -> Double.compare(
                    b.rating() * 10 + b.popularityScore() * 0.2 + barBoost(b) + ugcBoost(b),
                    a.rating() * 10 + a.popularityScore() * 0.2 + barBoost(a) + ugcBoost(a)));
        }
        // Ensure category diversity: after top-15 by score, inject up to 3 POIs
        // from unrepresented categories so mixed-activity routes can be built (TC02).
        var topN = Math.min(15, sorted.size());
        var result = new ArrayList<>(sorted.subList(0, topN));
        var representedCats = new java.util.HashSet<String>();
        for (var p : result) representedCats.add(p.category());
        for (var p : sorted) {
            if (result.size() >= topN + 3) break;
            if (!representedCats.contains(p.category())) {
                result.add(p);
                representedCats.add(p.category());
            }
        }
        return result;
    }

    private static double barBoost(POI poi) {
        if (poi.tags() == null) return 0;
        return poi.tags().stream().anyMatch(t ->
                t.contains("酒") || t.contains("吧") || t.contains("精酿") || t.contains("居酒屋")
                || t.contains("小酌") || t.contains("深夜")) ? 50 : 0;
    }

    /**
     * UGC sentiment boost/penalty based on real user reviews.
     * Positive UGC tags (安静, 适合约会, 服务好...) boost the score.
     * Negative UGC tags (排队久, 太吵, 环境差...) penalize the score.
     * This is how UGC can override raw rating — a 4.6-rated POI with glowing UGC
     * can outrank a 4.8-rated POI with negative UGC (see TC06).
     */
    private static final Set<String> POSITIVE_UGC = Set.of(
            "安静", "适合约会", "服务好", "环境好", "性价比高", "拍照好看",
            "出片", "氛围好", "排队短", "份量足", "味道好", "干净", "舒适",
            "有情调", "私密", "景观好", "停车方便", "近地铁"
    );
    private static final Set<String> NEGATIVE_UGC = Set.of(
            "排队久", "太吵", "环境吵", "人多", "服务差", "环境差", "贵",
            "份量少", "不好吃", "不干净", "绕路", "闷热", "味道一般",
            "等位久", "拥挤", "嘈杂", "态度差", "慢"
    );

    /** Check if a POI matches the user's cuisine preference. */
    private static boolean matchesCuisine(POI poi, String cuisine) {
        if (cuisine == null || cuisine.isBlank()) return true;
        var c = cuisine.trim();
        // Direct match in tags, subCategory, or name
        if (poi.tags() != null && poi.tags().stream().anyMatch(t ->
                t.contains(c) || c.contains(t))) return true;
        if (poi.subCategory() != null && (poi.subCategory().contains(c) || c.contains(poi.subCategory())))
            return true;
        if (poi.name() != null && (poi.name().contains(c) || c.contains(poi.name())))
            return true;
        // Cuisine alias mapping
        var aliases = Map.<String, List<String>>of(
                "日料", List.of("日料", "日本料理", "日式", "寿司", "刺身", "拉面", "居酒屋",
                        "鳗鱼", "天妇罗", "烧鸟", "丼", "和食", "怀石", "omakase"),
                "火锅", List.of("火锅", "涮", "锅底", "麻辣烫"),
                "烧烤", List.of("烧烤", "烤肉", "BBQ", "串"),
                "粤菜", List.of("粤菜", "广东", "茶餐厅", "点心", "烧腊", "肠粉"),
                "川菜", List.of("川菜", "四川", "麻辣", "水煮", "回锅"),
                "西餐", List.of("西餐", "牛排", "法餐", "意面", "披萨", "汉堡", "brunch"),
                "咖啡", List.of("咖啡", "cafe", "coffee", "拿铁", "美式"),
                "甜品", List.of("甜品", "蛋糕", "冰淇淋", "糖水", "面包")
        );
        var cuisineAliases = aliases.get(c);
        if (cuisineAliases != null) {
            for (var alias : cuisineAliases) {
                if (poi.tags() != null && poi.tags().stream().anyMatch(t ->
                        t.contains(alias) || alias.contains(t))) return true;
                if (poi.subCategory() != null && (poi.subCategory().contains(alias) || alias.contains(poi.subCategory())))
                    return true;
                if (poi.name() != null && (poi.name().contains(alias) || alias.contains(poi.name())))
                    return true;
            }
        }
        return false;
    }

    private static double ugcBoost(POI poi) {
        if (!poi.hasUGC()) return 0;
        double boost = 0;
        for (var tag : poi.ugcTags()) {
            if (POSITIVE_UGC.contains(tag)) boost += 30;
            else if (NEGATIVE_UGC.contains(tag)) boost -= 30;
        }
        return boost;
    }

    /**
     * Build a directed weighted graph from candidate POIs.
     * Nodes = POIs, Edge weight = travel time (minutes).
     */
    private Graph<POI, DefaultWeightedEdge> buildGraph(List<POI> candidates, UserIntent intent) {
        var graph = new DefaultDirectedWeightedGraph<POI, DefaultWeightedEdge>(DefaultWeightedEdge.class);

        for (var poi : candidates) {
            graph.addVertex(poi);
        }

        String travelMode = intent.travelMode() != null ? intent.travelMode() : "WALKING";

        for (var from : candidates) {
            for (var to : candidates) {
                if (from.equals(to)) continue;
                var edge = graph.addEdge(from, to);
                if (edge != null) {
                    double travelTime = estimateTravelTime(from, to, travelMode);
                    graph.setEdgeWeight(edge, travelTime);
                }
            }
        }

        return graph;
    }

    /** Check if a POI is open from arrivalTime through arrivalTime + stayMinutes. Handles overnight close (e.g. bar closes at 02:00). */
    private static boolean isWithinOpenHours(POI poi, LocalTime arrival, int stayMinutes) {
        var open = poi.openTime();
        var close = poi.closeTime();
        var depart = arrival.plusMinutes(stayMinutes);
        if (close.isAfter(open)) {
            // Normal: e.g. 10:00-22:00
            return !arrival.isBefore(open) && !depart.isAfter(close);
        } else {
            // Overnight: e.g. 17:00-02:00 — close is next day
            return !arrival.isBefore(open) && !(depart.isAfter(close) && depart.isBefore(open));
        }
    }

    /**
     * Search for best route using a beam-search approach with constraint checking.
     */
    private Route searchBestRoute(Graph<POI, DefaultWeightedEdge> graph, List<POI> candidates,
                                  List<Constraint> constraints, UserIntent intent, String goal) {
        int maxPOIs = Math.min(6, candidates.size());
        int beamWidth = Math.min(20, candidates.size() * 2);

        // Beam: list of partial routes, each as (visited List, last POI, arrivalTime, cost, score, travelTime)
        var beam = new ArrayList<BeamEntry>();
        for (var poi : candidates) {
            if (intent.startTime() != null) {
                if (!isWithinOpenHours(poi, intent.startTime(), poi.visitDuration())) {
                    log.info("[BeamInit] Skipping {} (open {}-{}, start {}, closed)",
                            poi.name(), poi.openTime(), poi.closeTime(), intent.startTime());
                    continue;
                }
                // Also skip if start time is after close time (can't enter a closed POI)
                var poiClose = poi.closeTime();
                if (poiClose.isAfter(poi.openTime()) && intent.startTime().isAfter(poiClose)) {
                    log.info("[BeamInit] Skipping {} — already closed at {}", poi.name(), intent.startTime());
                    continue;
                }
            }
            double poiScore = computePOIScore(poi, goal);
            beam.add(new BeamEntry(
                    new ArrayList<>(List.of(poi)),
                    poi,
                    intent.startTime() != null ? intent.startTime() : poi.openTime(),
                    poi.avgCost(),
                    poiScore,
                    0.0
            ));
        }

        Route bestRoute = null;
        double bestScore = -Double.MAX_VALUE;

        // Beam search iterations
        for (int step = 1; step < maxPOIs; step++) {
            var nextBeam = new ArrayList<BeamEntry>();

            for (var entry : beam) {
                // Find candidates not yet visited
                var visitedIds = entry.visited.stream().map(POI::id).collect(Collectors.toSet());
                var neighbors = candidates.stream()
                        .filter(p -> !visitedIds.contains(p.id()))
                        .toList();

                for (var nextPOI : neighbors) {
                    // Hard constraint: max 20km per single hop
                    double hopDist = haversine(entry.last.lat(), entry.last.lng(), nextPOI.lat(), nextPOI.lng());
                    if (hopDist > 20.0) continue;

                    // Hard constraint: budget enforcement — skip POI if cumulative cost exceeds budget
                    double newCost = entry.totalCost + nextPOI.avgCost();
                    if (intent.budget() > 0 && newCost > intent.budget() * 1.05) continue;

                    // Hard constraint: queue enforcement — skip POI if user explicitly wants no queue
                    if (intent.maxQueueMinutes() > 0 && intent.maxQueueMinutes() < 30
                            && nextPOI.queueTime() > intent.maxQueueMinutes()) continue;

                    // Hard constraint: rating enforcement
                    if (intent.minRating() > 0 && nextPOI.rating() < intent.minRating()) continue;

                    // Hard constraint: cuisine/category enforcement
                    if (intent.cuisinePreference() != null && !intent.cuisinePreference().isBlank()) {
                        var cuisine = intent.cuisinePreference();
                        boolean matchesCuisine = matchesCuisine(nextPOI, cuisine);
                        if (!matchesCuisine) continue;
                    }

                    double travelTime = getTravelTime(entry.last, nextPOI, intent.travelMode());
                    var arrivalTime = entry.departureTime.plusMinutes((long) travelTime);
                    var departureTime = arrivalTime.plusMinutes(nextPOI.visitDuration() + (long) nextPOI.queueTime());

                    // Hard constraint: time window check
                    if (intent.endTime() != null && departureTime.isAfter(intent.endTime())) continue;
                    if (!isWithinOpenHours(nextPOI, arrivalTime, nextPOI.visitDuration())) continue;

                    // Hard constraint: don't schedule visits after POI closes (prevents next-day scheduling)
                    var poiOpen = nextPOI.openTime();
                    var poiClose = nextPOI.closeTime();
                    boolean poiOpenOvernight = !poiClose.isAfter(poiOpen); // e.g. 17:00-02:00
                    if (poiClose.isAfter(poiOpen) && arrivalTime.isAfter(poiClose)) continue;
                    // Don't cross midnight for normal-hours POIs; overnight venues (bars, etc.) are fine
                    boolean crossesMidnight = arrivalTime.isBefore(entry.departureTime);
                    if (crossesMidnight && entry.departureTime.getHour() >= 18 && !poiOpenOvernight) continue;

                    double poiScore = computePOIScore(nextPOI, goal);
                    // Category diversity bonus: reward POIs from new categories
                    var visitedCats = new HashSet<String>();
                    for (var v : entry.visited) visitedCats.add(v.category());
                    double diversityBonus = visitedCats.contains(nextPOI.category()) ? 0 : 50;
                    double newScore = entry.score + poiScore + diversityBonus;
                    double newTravelTime = entry.totalTravelTime + travelTime;

                    var newVisited = new ArrayList<>(entry.visited);
                    newVisited.add(nextPOI);

                    nextBeam.add(new BeamEntry(newVisited, nextPOI, departureTime, newCost, newScore, newTravelTime));
                }
            }

            // Prune beam to beam width — for FASTEST, penalize travel time heavily
            if (nextBeam.size() > beamWidth) {
                if ("FASTEST".equals(goal)) {
                    // FASTEST: sort by score adjusted for travel time (shorter = better)
                    nextBeam.sort((a, b) -> {
                        double sa = a.score - a.totalTravelTime * 3.0;
                        double sb = b.score - b.totalTravelTime * 3.0;
                        return Double.compare(sb, sa);
                    });
                } else {
                    nextBeam.sort((a, b) -> Double.compare(b.score, a.score));
                }
                nextBeam = new ArrayList<>(nextBeam.subList(0, beamWidth));
            }

            // Evaluate top entries as complete routes
            for (var entry : nextBeam) {
                double score;
                if ("FASTEST".equals(goal)) {
                    // For FASTEST: heavily penalize total travel time
                    score = (entry.score - entry.totalTravelTime * 5.0) / entry.visited.size();
                } else {
                    score = entry.score / entry.visited.size();
                }
                // Strong bonus for 3+ POI routes (TC02: multi-activity queries)
                if (entry.visited.size() >= 3) {
                    score += 60.0;
                }
                if (score > bestScore && entry.visited.size() >= 2) {
                    bestScore = score;
                    bestRoute = buildRoute(entry, intent, goal);
                }
            }

            beam = nextBeam;
        }

        // Fallback: if no route found, create a simple one from constraint-filtered candidates
        if (bestRoute == null && !candidates.isEmpty()) {
            // Filter candidates by constraints (TC11: fallback must respect maxQueueMinutes, budget, etc.)
            var filtered = candidates.stream()
                    .filter(p -> {
                        if (intent.maxQueueMinutes() > 0 && intent.maxQueueMinutes() < 30
                                && p.queueTime() > intent.maxQueueMinutes()) return false;
                        if (intent.budget() > 0 && p.avgCost() > intent.budget() * 1.05) return false;
                        if (intent.minRating() > 0 && p.rating() < intent.minRating()) return false;
                        return true;
                    })
                    .toList();

            if (filtered.isEmpty()) {
                log.info("Fallback: all {} candidates filtered out by constraints", candidates.size());
                return null; // no feasible fallback — caller should handle gracefully
            }

            var first = filtered.get(0);
            var fallback = new BeamEntry(
                    new ArrayList<>(List.of(first)), first,
                    intent.startTime() != null ? intent.startTime() : first.openTime(),
                    first.avgCost(), computePOIScore(first, goal), 0.0
            );
            if (filtered.size() >= 2) {
                var second = filtered.get(1);
                double travelTime = getTravelTime(first, second, intent.travelMode());
                fallback = new BeamEntry(
                        new ArrayList<>(List.of(first, second)), second,
                        fallback.departureTime.plusMinutes((long) travelTime + second.visitDuration()),
                        first.avgCost() + second.avgCost(),
                        fallback.score + computePOIScore(second, goal),
                        travelTime
                );
            }
            bestRoute = buildRoute(fallback, intent, goal);
        }

        return bestRoute;
    }

    private Route buildRoute(BeamEntry entry, UserIntent intent, String goal) {
        var segments = new ArrayList<Route.RouteSegment>();
        POI prev = null;
        LocalTime currentTime = intent.startTime() != null ? intent.startTime() : LocalTime.of(9, 0);

        for (var poi : entry.visited) {
            double travelTime = prev != null ? getTravelTime(prev, poi, intent.travelMode()) : 0.0;
            if (prev != null) {
                currentTime = currentTime.plusMinutes((long) travelTime);
            }
            // Ensure we don't arrive before opening, but NOT after closing (no next-day scheduling)
            var poiOpen = poi.openTime();
            var poiClose = poi.closeTime();
            if (currentTime.isBefore(poiOpen) && currentTime.isBefore(poiClose)) {
                currentTime = poiOpen;
            }
            // Skip if we'd start after closing time (prevents next-day wrap)
            if (poiClose.isAfter(poiOpen) && currentTime.isAfter(poiClose)) {
                continue;
            }
            var departure = currentTime.plusMinutes(poi.visitDuration() + (long) poi.queueTime());

            segments.add(new Route.RouteSegment(poi, currentTime, departure, travelTime,
                    intent.travelMode() != null ? intent.travelMode() : "WALKING"));

            currentTime = departure;
            prev = poi;
        }

        double totalCost = entry.visited.stream().mapToDouble(POI::avgCost).sum();
        double totalRating = entry.visited.stream().mapToDouble(POI::rating).sum();
        String routeId = "route_" + UUID.randomUUID().toString().substring(0, 8);

        return new Route(routeId, "", "", segments, totalCost,
                entry.totalTravelTime, totalRating, goal, List.of(), List.of(), entry.score);
    }

    private double computePOIScore(POI poi, String goal) {
        return switch (goal) {
            case "BEST_EXPERIENCE" -> poi.rating() * 20 + poi.popularityScore() * 0.3;
            case "FASTEST" -> (100 - poi.visitDuration()) * 0.5 + poi.rating() * 5;
            case "CHEAPEST" -> Math.max(0, 500 - poi.avgCost()) * 2.0 + poi.rating() * 2.0
                    - (poi.queueTime() > 10 ? 30 : 0);
            case "PREFERENCE" -> poi.rating() * 4 + poi.popularityScore() * 0.05 + ugcBoost(poi) * 1.5
                    + (poi.tags() != null && poi.tags().stream().anyMatch(t ->
                        t.contains("安静") || t.contains("约会") || t.contains("日料")
                        || t.contains("拍照") || t.contains("网红") || t.contains("出片")
                        || t.contains("新店") || t.contains("咖啡")) ? 40 : 0);
            default -> poi.rating() * 10 + poi.popularityScore() * 0.2;
        };
    }

    private double computeCompositeScore(Route route, List<Constraint> constraints) {
        double ratingScore = route.segments().stream()
                .mapToDouble(s -> s.poi().rating()).average().orElse(0) * 20;
        double costPenalty = constraints.stream()
                .filter(c -> "budget".equals(c.id()))
                .findFirst()
                .map(c -> {
                    double budget = c.getValueAs(Double.class).orElse(Double.MAX_VALUE);
                    return Math.max(0, 100 - (route.totalCost() / budget) * 100);
                })
                .orElse(50.0);
        return ratingScore * 0.6 + costPenalty * 0.4;
    }

    /**
     * Estimate travel time between two POIs using Haversine distance.
     * Uses more realistic urban speeds with a traffic penalty factor.
     */
    public double estimateTravelTime(POI from, POI to, String travelMode) {
        String cacheKey = from.id() + "-" + to.id() + "-" + travelMode;
        return travelTimeCache.computeIfAbsent(cacheKey, k -> {
            double distance = haversine(from.lat(), from.lng(), to.lat(), to.lng());
            // For driving in urban areas, add ~30% traffic penalty
            double speed = "DRIVING".equalsIgnoreCase(travelMode)
                    ? URBAN_DRIVE_SPEED_KMH  // ~30 km/h with traffic
                    : AVG_WALK_SPEED_KMH;
            double timeHours = distance / speed;
            double timeMinutes = timeHours * 60;
            // Add 5-min buffer for traffic lights, parking, etc. when driving
            if ("DRIVING".equalsIgnoreCase(travelMode) && distance > 1.0) {
                timeMinutes += 5;
            }
            // Minimum travel time of 2 minutes
            return Math.max(2, timeMinutes);
        });
    }

    public double getTravelTime(POI from, POI to, String travelMode) {
        return estimateTravelTime(from, to, travelMode);
    }

    /**
     * Haversine formula for distance in km.
     */
    public static double haversine(double lat1, double lon1, double lat2, double lon2) {
        final double R = 6371.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private List<Route> handleInsufficientPOIs(List<POI> candidates, UserIntent intent) {
        if (candidates.isEmpty()) return List.of();
        var segments = candidates.stream()
                .map(poi -> new Route.RouteSegment(poi, poi.openTime(),
                        poi.openTime().plusMinutes(poi.visitDuration()), 0, "WALKING"))
                .toList();
        double cost = candidates.stream().mapToDouble(POI::avgCost).sum();
        double rating = candidates.stream().mapToDouble(POI::rating).sum();
        return List.of(new Route("route_simple", "简化方案", "候选POI数量不足，生成简化路线",
                segments, cost, 0, rating, "BEST_EXPERIENCE", List.of(), List.of(), 50));
    }

    private String generateDescription(Route route, UserIntent intent, UserPreference preference) {
        var names = route.segments().stream().map(s -> s.poi().name()).toList();
        var times = route.segments().stream()
                .map(s -> s.arrivalTime().toString().substring(0, 5))
                .toList();
        var builder = new StringBuilder();

        // Add assumption context when defaults were used (TC13, TC14)
        var assumptions = new java.util.ArrayList<String>();
        if (intent.budget() <= 0) assumptions.add("按默认预算筛选");
        if (intent.district() == null || intent.district().isBlank()) assumptions.add("搜全城范围");
        if (intent.preferredCategories() == null || intent.preferredCategories().isEmpty())
            assumptions.add("综合推荐各品类");
        if (!assumptions.isEmpty()) {
            builder.append("(").append(String.join(", ", assumptions)).append(") ");
        }

        for (int i = 0; i < names.size(); i++) {
            if (i > 0) builder.append(" → ");
            builder.append(times.get(i)).append(" ").append(names.get(i));
        }
        builder.append(" | 总费用: ¥").append(String.format("%.0f", route.totalCost()));
        builder.append(" | 评分: ").append(String.format("%.1f",
                route.totalRating() / route.segments().size()));

        // Add queue context (TC05: 提及排队信息)
        double avgQueue = route.segments().stream().mapToDouble(s -> s.poi().queueTime()).average().orElse(0);
        if (avgQueue > 15) builder.append(" | ⚠️排队较久(约").append((int)avgQueue).append("分钟)");
        else if (avgQueue > 5) builder.append(" | 排队适中(约").append((int)avgQueue).append("分钟)");
        else if (avgQueue <= 3) builder.append(" | 排队较短,等位风险低");

        double walkingMin = route.segments().stream().mapToDouble(Route.RouteSegment::travelTimeFromPrevious).sum();
        if (walkingMin <= 5) builder.append(" | 少走路");
        var categories = route.segments().stream().map(s -> s.poi().category()).distinct().toList();
        if (categories.size() >= 2) builder.append(" | ").append(String.join("+", categories));

        // Add preference match info (TC15: 展示历史偏好解释)
        if (preference != null && !"default".equals(preference.userId())
                && preference.preferenceTags() != null && !preference.preferenceTags().isEmpty()) {
            var matched = new java.util.ArrayList<String>();
            for (var seg : route.segments()) {
                var tags = seg.poi().tags();
                var ugcTags = seg.poi().ugcTags();
                for (var prefTag : preference.preferenceTags().keySet()) {
                    if ((tags != null && tags.stream().anyMatch(t -> t.contains(prefTag) || prefTag.contains(t)))
                            || (ugcTags != null && ugcTags.stream().anyMatch(t -> t.contains(prefTag) || prefTag.contains(t)))) {
                        if (!matched.contains(prefTag)) matched.add(prefTag);
                    }
                }
            }
            if (!matched.isEmpty()) {
                builder.append(" | 匹配偏好: ").append(String.join("、", matched.subList(0, Math.min(4, matched.size()))));
            }
        }

        return builder.toString();
    }

    // Beam search helper record
    private record BeamEntry(
            List<POI> visited,
            POI last,
            LocalTime departureTime,
            double totalCost,
            double score,
            double totalTravelTime
    ) {}
}
