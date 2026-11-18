package com.example.logistics.shipment;

import com.example.logistics.hub.Hub;
import com.example.logistics.hub.HubRef;
import com.example.logistics.hub.RoutePlanner;
import com.example.logistics.hub.Routes;
import com.example.logistics.vehicle.VehicleType;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

@Component
public class PricingService {
    private static final BigDecimal BASE_FEE = new BigDecimal("10.00");
    private static final double RATE_PER_KG = 0.35;
    private static final double RATE_PER_KG_PER_KM = 0.0012;
    private static final BigDecimal AIR_MULTIPLIER = new BigDecimal("2.2");
    private static final Duration AIR_EXTRA_PROMISE = Duration.ofHours(24);

    private final RoutePlanner routes;

    public PricingService(RoutePlanner routes) {
        this.routes = routes;
    }

    public QuoteView quote(Hub origin, Hub destination, double weightKg, Priority priority, Instant now) {
        boolean air = Routes.requiresAir(origin, destination);
        double km = Routes.distanceKm(origin, destination);

        BigDecimal perKg = BigDecimal.valueOf(RATE_PER_KG + km * RATE_PER_KG_PER_KM);
        BigDecimal price = BASE_FEE.add(perKg.multiply(BigDecimal.valueOf(weightKg)))
                .multiply(priority.priceMultiplier());
        if (air) {
            price = price.multiply(AIR_MULTIPLIER);
        }
        price = price.setScale(2, RoundingMode.HALF_UP);

        List<Hub> path = routes.path(origin, destination);
        Duration transit = Duration.ZERO;
        for (int i = 1; i < path.size(); i++) {
            Hub from = path.get(i - 1);
            Hub to = path.get(i);
            VehicleType typical = Routes.requiresAir(from, to) ? VehicleType.AIR_CARGO : VehicleType.LORRY;
            transit = transit.plus(Routes.travelTime(Routes.distanceKm(from, to), typical));
        }
        Duration promise = air ? priority.promise().plus(AIR_EXTRA_PROMISE) : priority.promise();
        String mode = !air ? "Road freight" : path.size() > 2 ? "Road freight + air transfer" : "Air freight";

        var direction = origin.directionTo(destination);
        return new QuoteView(HubRef.from(origin), HubRef.from(destination), km, direction, direction.label(), air,
                mode, path.stream().map(Hub::getCode).toList(), weightKg, priority, price,
                Math.round(transit.toMinutes() / 6.0) / 10.0, now.plus(promise));
    }
}
