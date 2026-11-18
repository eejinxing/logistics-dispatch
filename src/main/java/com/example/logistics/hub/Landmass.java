package com.example.logistics.hub;

public enum Landmass {
    PENINSULAR("Peninsular Malaysia"), BORNEO("East Malaysia");

    private final String label;

    Landmass(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}
