package com.example.logistics.vehicle;

public enum VehicleType {
    VAN("Van", 1_000, 75, false),
    LORRY("Lorry", 5_000, 65, false),
    TRAILER("Trailer", 20_000, 60, false),
    AIR_CARGO("Cargo aircraft", 8_000, 600, true);

    private final String label;
    private final int defaultCapacityKg;
    private final double speedKmh;
    private final boolean air;

    VehicleType(String label, int defaultCapacityKg, double speedKmh, boolean air) {
        this.label = label;
        this.defaultCapacityKg = defaultCapacityKg;
        this.speedKmh = speedKmh;
        this.air = air;
    }

    public String label() {
        return label;
    }

    public int defaultCapacityKg() {
        return defaultCapacityKg;
    }

    public double speedKmh() {
        return speedKmh;
    }

    public boolean isAir() {
        return air;
    }
}
