package com.meituan.route;

import com.meituan.route.data.MockDataService;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

import java.util.*;

public class POICountTest {

    @Test
    public void countPOIs() {
        MockDataService svc = new MockDataService();

        for (String city : List.of("北京", "上海")) {
            var pois = svc.getAllByCity(city).collectList().block();
            var byCategory = new TreeMap<String, Set<String>>();
            var bySubCategory = new TreeMap<String, Integer>();
            int withPhotos = 0;
            double minPrice = 9999, maxPrice = 0;
            double minRating = 10, maxRating = 0;

            for (var p : pois) {
                byCategory.computeIfAbsent(p.category(), k -> new TreeSet<>()).add(p.subCategory());
                bySubCategory.merge(p.category() + " → " + p.subCategory(), 1, Integer::sum);
                if (p.imageUrl() != null && !p.imageUrl().isBlank()) withPhotos++;
                if (p.avgCost() < minPrice) minPrice = p.avgCost();
                if (p.avgCost() > maxPrice) maxPrice = p.avgCost();
                if (p.rating() < minRating) minRating = p.rating();
                if (p.rating() > maxRating) maxRating = p.rating();
            }

            System.out.println("\n========================================");
            System.out.println("  " + city + " — Total: " + pois.size() + " POIs");
            System.out.println("  With photos: " + withPhotos + "/" + pois.size());
            System.out.println("  Price range: ¥" + (int)minPrice + " ~ ¥" + (int)maxPrice);
            System.out.println("  Rating range: " + minRating + " ~ " + maxRating);
            System.out.println("========================================");
            System.out.println("  By category:");
            for (var e : byCategory.entrySet()) {
                System.out.println("    " + e.getKey() + " (" + e.getValue().size() + " sub-types)");
            }
            System.out.println("  Sub-category breakdown:");
            for (var e : bySubCategory.entrySet()) {
                System.out.println("    " + e.getKey() + ": " + e.getValue());
            }
        }
    }
}
