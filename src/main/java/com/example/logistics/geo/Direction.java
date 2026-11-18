package com.example.logistics.geo;

public enum Direction {
    N("North"), NE("Northeast"), E("East"), SE("Southeast"), S("South"), SW("Southwest"), W("West"), NW("Northwest");

    private final String label;

    Direction(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static Direction fromBearing(double degrees) {
        double normalised = ((degrees % 360) + 360) % 360;
        int index = (int) Math.round(normalised / 45.0) % 8;
        return values()[index];
    }
}
