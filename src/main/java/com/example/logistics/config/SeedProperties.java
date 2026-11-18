package com.example.logistics.config;

import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "app.seed")
public record SeedProperties(
        boolean enabled,
        @Min(0) int historyDays,
        @Min(0) int historyShipments,
        @Min(0) int pendingShipments) {
}
