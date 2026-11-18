package com.example.logistics.hub;

import com.example.logistics.vehicle.VehicleType;

import java.time.Duration;

public final class Routes {
    private static final double ROAD_FACTOR = 1.25;
    private static final double AIR_FACTOR = 1.05;
    private static final Duration AIR_HANDLING = Duration.ofMinutes(90);

    private Routes() {
    }

    public static boolean requiresAir(Hub origin, Hub destination) {
        return origin.getLandmass() != destination.getLandmass();
    }

    public static double distanceKm(Hub origin, Hub destination) {
        double factor = requiresAir(origin, destination) ? AIR_FACTOR : ROAD_FACTOR;
        return Math.round(origin.greatCircleKmTo(destination) * factor * 10) / 10.0;
    }

    public static Duration travelTime(double distanceKm, VehicleType type) {
        long minutes = Math.round(distanceKm / type.speedKmh() * 60);
        Duration travel = Duration.ofMinutes(Math.max(minutes, 20));
        return type.isAir() ? travel.plus(AIR_HANDLING) : travel;
    }

    public static boolean canServe(VehicleType type, Hub origin, Hub destination) {
        return type.isAir() == requiresAir(origin, destination);
    }
}
