package com.meituan.route;

import com.meituan.route.data.MockDataService;
import java.lang.reflect.Method;
import java.lang.reflect.Field;
import java.util.List;
import java.util.Map;

public class QuickCountTest {
    public static void main(String[] args) throws Exception {
        MockDataService svc = new MockDataService();
        // Access private poiByCity field
        Field f = MockDataService.class.getDeclaredField("poiByCity");
        f.setAccessible(true);
        @SuppressWarnings("unchecked")
        Map<String, List<?>> poiByCity = (Map<String, List<?>>) f.get(svc);

        for (String city : List.of("北京", "上海")) {
            var pois = poiByCity.get(city);
            var categories = new java.util.TreeMap<String, Integer>();
            for (var p : pois) {
                String cat = p.getClass().getMethod("category").invoke(p).toString();
                categories.merge(cat, 1, Integer::sum);
            }
            System.out.println("=== " + city + ": " + pois.size() + " POIs ===");
            for (var e : categories.entrySet()) {
                System.out.println("  " + e.getKey() + ": " + e.getValue());
            }
        }
    }
}
