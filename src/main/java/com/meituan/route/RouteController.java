package com.meituan.route;

import com.meituan.route.llm.IntentParser;
import com.meituan.route.model.IntentAnalysisResult;
import com.meituan.route.model.UserIntent;
import com.meituan.route.model.UserPreference;
import com.meituan.route.orchestrator.RoutePlannerOrchestrator;
import com.meituan.route.service.UserProfileService;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import com.meituan.route.data.DataService;
import com.meituan.route.model.POI;
import com.meituan.route.model.Route;
import com.meituan.route.repository.SessionRepository;
import com.meituan.route.repository.SnapshotRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/route")
public class RouteController {

    private final RoutePlannerOrchestrator orchestrator;
    private final IntentParser intentParser;
    private final UserProfileService userProfileService;
    private final com.meituan.route.agent.AgentLoopOrchestrator agentLoopOrchestrator;
    private final DataService dataService;
    private final SessionRepository sessionRepository;
    private final SnapshotRepository snapshotRepository;
    private final ObjectMapper objectMapper;

    public RouteController(RoutePlannerOrchestrator orchestrator, IntentParser intentParser,
                           UserProfileService userProfileService,
                           com.meituan.route.agent.AgentLoopOrchestrator agentLoopOrchestrator,
                           DataService dataService,
                           SessionRepository sessionRepository,
                           SnapshotRepository snapshotRepository) {
        this.orchestrator = orchestrator;
        this.intentParser = intentParser;
        this.userProfileService = userProfileService;
        this.agentLoopOrchestrator = agentLoopOrchestrator;
        this.dataService = dataService;
        this.sessionRepository = sessionRepository;
        this.snapshotRepository = snapshotRepository;
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
    }

    @PostMapping(value = "/plan", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<RoutePlannerOrchestrator.PlanResponse> plan(@RequestBody PlanRequest request,
                                                             ServerHttpRequest httpRequest) {
        var userId = resolveUserId(request.userId(), httpRequest);
        return orchestrator.planRoute(request.query(), request.sessionId(), request.city(),
                request.intent(), userId);
    }

    @PostMapping(value = "/analyze", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<IntentAnalysisResult> analyze(@RequestBody AnalyzeRequest request) {
        return Mono.fromCallable(() ->
                intentParser.analyzeWithCompleteness(request.query(), request.sessionId(), request.city()));
    }

    @PostMapping(value = "/smart-plan", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<Map<String, Object>> smartPlan(@RequestBody AnalyzeRequest request,
                                                ServerHttpRequest httpRequest) {
        var userId = resolveUserId(request.userId(), httpRequest);
        return Mono.fromCallable(() ->
                intentParser.analyzeWithCompleteness(request.query(), request.sessionId(), request.city()))
                .subscribeOn(Schedulers.boundedElastic())
                .flatMap(analysis -> {
                    var stage = analysis.stage();
                    var result = new java.util.LinkedHashMap<String, Object>();
                    result.put("stage", stage);
                    result.put("summaryText", analysis.summaryText());

                    if ("followup".equals(stage) || "conflict".equals(stage)) {
                        result.put("intent", analysis.intent());
                        result.put("followupQuestions", analysis.followupQuestions());
                        result.put("conflicts", analysis.conflicts());
                        result.put("missingFields", analysis.missingFields());
                        result.put("routes", null);
                        return Mono.just(result);
                    }

                    result.put("intent", analysis.intent());
                    return orchestrator.planRoute(
                            request.query(),
                            analysis.intent().sessionId(),
                            request.city(),
                            analysis.intent(),
                            userId)
                            .map(plan -> {
                                result.put("routes", plan.routes());
                                result.put("warning", plan.warning());
                                result.put("recommendedRoute", plan.recommendedRoute());
                                result.put("explanation", plan.explanation());
                                result.put("sessionId", plan.sessionId());
                                result.put("preferenceMatchTags", plan.preferenceMatchTags());
                                result.put("preferenceScores", plan.preferenceScores());
                                result.put("ugcMatchTags", plan.ugcMatchTags());
                                result.put("ugcSummaries", plan.ugcSummaries());
                                return result;
                            });
                });
    }

    @PostMapping(value = "/adjust", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<RoutePlannerOrchestrator.PlanResponse> adjust(@RequestBody AdjustRequest request,
                                                               ServerHttpRequest httpRequest) {
        var userId = resolveUserId(request.userId(), httpRequest);
        return orchestrator.adjustRoute(request.sessionId(), request.adjustment(), request.city(), userId);
    }

    @GetMapping(value = "/compare/{sessionId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<RoutePlannerOrchestrator.CompareResponse> compare(@PathVariable String sessionId) {
        return orchestrator.getComparison(sessionId);
    }

    /**
     * POST /api/route/agent-plan — LLM-driven Agent Loop planning.
     * Uses the new 1-Agent + Tools architecture: the LLM dynamically decides
     * which tools to call instead of following a fixed pipeline.
     * Falls back to the existing pipeline if the Agent Loop cannot complete.
     */
    @PostMapping(value = "/agent-plan", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<RoutePlannerOrchestrator.PlanResponse> agentPlan(@RequestBody PlanRequest request,
                                                                  ServerHttpRequest httpRequest) {
        var userId = resolveUserId(request.userId(), httpRequest);
        return agentLoopOrchestrator.agentPlan(request.query(), request.sessionId(), request.city(), userId);
    }

    /**
     * GET /api/route/pois?city=北京 — Return POI data for a city.
     * Unifies frontend and backend POI data: frontend fetches from this endpoint
     * instead of maintaining a separate mock dataset.
     */
    @GetMapping(value = "/pois", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<List<Map<String, Object>>> getPOIs(@RequestParam(defaultValue = "北京") String city) {
        return dataService.getAllByCity(city)
                .map(poi -> Map.<String, Object>ofEntries(
                        Map.entry("id", poi.id()),
                        Map.entry("name", poi.name()),
                        Map.entry("category", poi.category()),
                        Map.entry("subCategory", poi.subCategory()),
                        Map.entry("district", poi.district()),
                        Map.entry("city", poi.city()),
                        Map.entry("rating", poi.rating()),
                        Map.entry("avgCost", poi.avgCost()),
                        Map.entry("queueTime", poi.queueTime()),
                        Map.entry("tags", poi.tags()),
                        Map.entry("riskTags", poi.riskTags()),
                        Map.entry("ugcTags", poi.ugcTags()),
                        Map.entry("ugcSummary", poi.ugcSummary()),
                        Map.entry("imageUrl", poi.imageUrl()),
                        Map.entry("address", poi.address()),
                        Map.entry("description", poi.description()),
                        Map.entry("popularityScore", poi.popularityScore()),
                        Map.entry("lat", poi.lat()),
                        Map.entry("lng", poi.lng())
                ))
                .collectList();
    }

    @GetMapping(value = "/health", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<Map<String, String>> health() {
        return Mono.just(Map.of("status", "UP", "service", "AI Route Planner"));
    }

    /**
     * GET /api/route/profiles — List all user profiles for the frontend user switcher.
     */
    @GetMapping(value = "/profiles", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<List<UserPreference>> listProfiles() {
        return userProfileService.listAllProfiles();
    }

    /**
     * GET /api/route/sessions?userId=xxx — List session history for a user.
     * Returns lightweight session summaries (no full route data) for the sidebar history panel.
     * Persists across devices/IPs since data is stored in PostgreSQL by userId.
     */
    @GetMapping(value = "/sessions", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<List<Map<String, Object>>> listSessions(@RequestParam String userId,
                                                         ServerHttpRequest httpRequest) {
        var uid = resolveUserId(userId, httpRequest);
        if (uid == null || uid.isBlank()) {
            return Mono.just(List.of());
        }
        return Mono.fromCallable(() -> {
            var entities = sessionRepository.findByUserIdOrderByCreatedAtDesc(uid);
            return entities.stream().map(e -> {
                Map<String, Object> m = new java.util.LinkedHashMap<>();
                m.put("sessionId", e.getId());
                m.put("userId", e.getUserId());
                m.put("scene", extractSceneFromIntent(e.getIntentJson()));
                m.put("firstQuery", extractQueryFromIntent(e.getIntentJson()));
                m.put("timeLabel", e.getCreatedAt().toString().substring(0, 16).replace("T", " "));
                m.put("createdAt", e.getCreatedAt().toString());

                // Load snapshots to reconstruct routes & conversation messages
                var snapshots = snapshotRepository.findBySessionIdOrderByVersionAsc(e.getId());
                var conversationMessages = new java.util.ArrayList<Map<String, Object>>();
                var routes = new java.util.ArrayList<Map<String, Object>>();
                for (var snap : snapshots) {
                    // Add user message if query text exists
                    if (snap.getQueryText() != null && !snap.getQueryText().isBlank()) {
                        Map<String, Object> userMsg = new java.util.LinkedHashMap<>();
                        userMsg.put("type", "user");
                        userMsg.put("text", snap.getQueryText());
                        userMsg.put("_key", "u-" + snap.getId());
                        conversationMessages.add(userMsg);
                    }
                    // Add route block
                    try {
                        var route = objectMapper.readValue(snap.getRouteJson(), Route.class);
                        var routeMap = routeToFrontendMap(route);
                        routeMap.put("_key", "r-" + snap.getId());
                        Map<String, Object> routeMsg = new java.util.LinkedHashMap<>();
                        routeMsg.put("type", "route");
                        routeMsg.put("scene", extractSceneFromIntent(snap.getIntentJson()));
                        routeMsg.put("routes", List.of(routeMap));
                        conversationMessages.add(routeMsg);
                        routes.add(routeMap);
                    } catch (Exception ignored) {}
                }
                m.put("conversationMessages", conversationMessages);
                m.put("routes", routes);
                m.put("messageCount", conversationMessages.size());
                return (Map<String, Object>) m;
            }).toList();
        }).subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * GET /api/route/sessions/{sessionId} — Load a specific session with full route data.
     * Used when clicking a history item to reload the full conversation.
     */
    @GetMapping(value = "/sessions/{sessionId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<Map<String, Object>> getSessionDetail(@PathVariable String sessionId) {
        return Mono.fromCallable(() -> {
            var entityOpt = sessionRepository.findById(sessionId);
            if (entityOpt.isEmpty()) return null;
            var e = entityOpt.get();
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("sessionId", e.getId());
            m.put("userId", e.getUserId());
            m.put("scene", extractSceneFromIntent(e.getIntentJson()));

            var snapshots = snapshotRepository.findBySessionIdOrderByVersionAsc(sessionId);
            var conversationMessages = new java.util.ArrayList<Map<String, Object>>();
            var routes = new java.util.ArrayList<Map<String, Object>>();
            for (var snap : snapshots) {
                if (snap.getQueryText() != null && !snap.getQueryText().isBlank()) {
                    Map<String, Object> userMsg = new java.util.LinkedHashMap<>();
                    userMsg.put("type", "user");
                    userMsg.put("text", snap.getQueryText());
                    userMsg.put("_key", "u-" + snap.getId());
                    conversationMessages.add(userMsg);
                }
                try {
                    var route = objectMapper.readValue(snap.getRouteJson(), Route.class);
                    var routeMap = routeToFrontendMap(route);
                    routeMap.put("_key", "r-" + snap.getId());
                    Map<String, Object> routeMsg = new java.util.LinkedHashMap<>();
                    routeMsg.put("type", "route");
                    routeMsg.put("scene", extractSceneFromIntent(snap.getIntentJson()));
                    routeMsg.put("routes", List.of(routeMap));
                    conversationMessages.add(routeMsg);
                    routes.add(routeMap);
                } catch (Exception ignored) {}
            }
            m.put("conversationMessages", conversationMessages);
            m.put("routes", routes);
            return m;
        }).subscribeOn(Schedulers.boundedElastic());
    }

    /** Convert a backend Route to a frontend-friendly map (mirrors api.js mapRoute logic). */
    private Map<String, Object> routeToFrontendMap(Route route) {
        var m = new java.util.LinkedHashMap<String, Object>();
        m.put("id", route.id());
        m.put("route_name", route.name());
        m.put("total_avg", Math.round(route.totalCost()));
        m.put("total_time", route.totalTravelTime() < 60
                ? Math.round(route.totalTravelTime()) + " 分钟"
                : (route.totalTravelTime() / 60) + " 小时");
        m.put("optimizationGoal", route.optimizationGoal() != null ? route.optimizationGoal() : "BEST_EXPERIENCE");
        var pois = route.segments().stream().map(seg -> {
            var pm = new java.util.LinkedHashMap<String, Object>();
            pm.put("short", seg.poi().name());
            pm.put("category", seg.poi().category() != null ? seg.poi().category() : "");
            pm.put("rating", seg.poi().rating());
            pm.put("avgCost", seg.poi().avgCost());
            return (Map<String, Object>) pm;
        }).toList();
        m.put("pois", pois);
        m.put("total_distance", route.totalTravelTime() < 10 ? "步行可达" : Math.round(route.totalTravelTime() * 80) + "m");
        return m;
    }

    private String extractSceneFromIntent(String intentJson) {
        if (intentJson == null) return "对话";
        try {
            var node = objectMapper.readTree(intentJson);
            if (node.has("keywords") && node.get("keywords").size() > 0) {
                return node.get("keywords").get(0).asText();
            }
            if (node.has("specialRequest") && !node.get("specialRequest").isNull() && !node.get("specialRequest").asText().isBlank()) {
                return node.get("specialRequest").asText();
            }
        } catch (Exception ignored) {}
        return "对话";
    }

    private String extractQueryFromIntent(String intentJson) {
        try {
            var node = objectMapper.readTree(intentJson);
            if (node.has("rawQuery") && !node.get("rawQuery").isNull()) {
                var q = node.get("rawQuery").asText();
                return q.length() > 50 ? q.substring(0, 50) + "…" : q;
            }
        } catch (Exception ignored) {}
        return "";
    }


    /**
     * Resolve userId: prefer AuthFilter's exchange attribute (from JWT),
     * fall back to request body parameter for backward compatibility.
     */
    private String resolveUserId(String bodyUserId, ServerHttpRequest httpRequest) {
        // AuthFilter sets this attribute after JWT validation
        var authUserId = httpRequest.getAttributes().get("userId");
        if (authUserId instanceof String uid && !uid.isBlank()) {
            return uid;
        }
        // Fallback: use body userId (for backward compatibility)
        return bodyUserId;
    }

    // Request DTOs
    public record PlanRequest(String query, String sessionId, String city, UserIntent intent, String userId) {}
    public record AnalyzeRequest(String query, String sessionId, String city, String userId) {}
    public record AdjustRequest(String sessionId, String adjustment, String city, String userId) {}
}
