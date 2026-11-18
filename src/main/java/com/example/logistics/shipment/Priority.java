package com.example.logistics.shipment;

import java.math.BigDecimal;
import java.time.Duration;

public enum Priority {
    STANDARD("Standard", new BigDecimal("1.0"), Duration.ofHours(48)),
    EXPRESS("Express", new BigDecimal("1.6"), Duration.ofHours(24));

    private final String label;
    private final BigDecimal priceMultiplier;
    private final Duration promise;

    Priority(String label, BigDecimal priceMultiplier, Duration promise) {
        this.label = label;
        this.priceMultiplier = priceMultiplier;
        this.promise = promise;
    }

    public String label() {
        return label;
    }

    public BigDecimal priceMultiplier() {
        return priceMultiplier;
    }

    public Duration promise() {
        return promise;
    }
}
