package com.example.logistics.dispatch;

public enum TripStatus {
    LOADING("Loading"), IN_TRANSIT("In transit"), ARRIVED("Arrived");

    private final String label;

    TripStatus(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}
