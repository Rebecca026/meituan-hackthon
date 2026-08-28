package com.meituan.route.agent;

import com.meituan.route.llm.RecommendationExplainer;
import com.meituan.route.model.Route;
import com.meituan.route.model.UserIntent;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * ExplanationAgent generates natural language explanations and recommendations
 * for each route plan, highlighting differences between options.
 */
@Component
public class ExplanationAgent {

    private final RecommendationExplainer explainer;

    public ExplanationAgent(RecommendationExplainer explainer) {
        this.explainer = explainer;
    }

    /**
     * Generate explanations for a set of route plans.
     */
    public ExplanationResult explain(List<Route> routes, UserIntent intent) {
        if (routes.isEmpty()) {
            return new ExplanationResult("暂无可用方案", "没有找到满足条件的路线方案", routes, null);
        }

        var detailed = explainer.compareRoutes(routes);
        var summary = buildSummary(routes, intent);

        return new ExplanationResult(summary, detailed, routes, detailed);
    }

    /**
     * Generate explanation for a single route (e.g., after adjustment).
     */
    public ExplanationResult explainSingle(Route route, UserIntent intent) {
        var text = explainer.explainRoute(route);
        var summary = buildSingleSummary(route);
        return new ExplanationResult(summary, text, List.of(route), text);
    }

    private String buildSummary(List<Route> routes, UserIntent intent) {
        var sb = new StringBuilder();

        String district = intent.district() != null ? intent.district() : intent.city();
        String city = intent.city() != null ? intent.city() : "北京";

        // Mention assumptions when fields are filled by defaults
        var assumptions = new ArrayList<String>();
        if (intent.budget() <= 0) assumptions.add("预算未指定，已按合理范围筛选");
        if (intent.district() == null || intent.district().isBlank()) assumptions.add("未指定具体区域，已搜索" + city + "全市");
        if (intent.preferredCategories() == null || intent.preferredCategories().isEmpty()) assumptions.add("未限定品类，已综合推荐");

        if (!assumptions.isEmpty()) {
            sb.append("（").append(String.join("；", assumptions)).append("）\n");
        }

        sb.append("为您规划了").append(routes.size()).append("条").append(district).append("路线方案：\n");

        for (int i = 0; i < routes.size(); i++) {
            var route = routes.get(i);
            String goalLabel = switch (route.optimizationGoal()) {
                case "BEST_EXPERIENCE" -> "体验最优";
                case "FASTEST" -> "最高效";
                case "CHEAPEST" -> "最省钱";
                case "PREFERENCE" -> "偏好优先";
                default -> "方案" + (i + 1);
            };
            sb.append(i + 1).append(". ").append(goalLabel).append("：");
            sb.append(route.segments().size()).append("站 | ");
            sb.append("¥").append(String.format("%.0f", route.totalCost())).append(" | ");
            double walking = route.segments().stream().mapToDouble(r -> r.travelTimeFromPrevious()).sum();
            sb.append("步行").append(Math.round(walking)).append("分钟 | ");
            sb.append("均分").append(String.format("%.1f",
                    route.totalRating() / route.segments().size()));
            // Add queue context
            double avgQueue = route.segments().stream().mapToDouble(s -> s.poi().queueTime()).average().orElse(0);
            if (avgQueue > 10) sb.append(" | ⚠️需排队");
            else sb.append(" | 基本免排队");
            sb.append("\n");
        }

        return sb.toString();
    }

    private String buildSingleSummary(Route route) {
        var names = route.segments().stream().map(s -> s.poi().name()).toList();
        return "为您更新路线：" + String.join(" → ", names);
    }

    public record ExplanationResult(
            String summary,
            String detailedExplanation,
            List<Route> routes,
            String comparisonHtml
    ) {}
}
