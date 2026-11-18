package com.example.logistics.vehicle;

public enum VehicleStatus {
    IDLE("Available"), ON_TRIP("On trip"), MAINTENANCE("Under maintenance");

    private final String label;

    VehicleStatus(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}
