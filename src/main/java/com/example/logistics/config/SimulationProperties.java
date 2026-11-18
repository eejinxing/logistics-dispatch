package com.example.logistics.config;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;

@Validated
@ConfigurationProperties(prefix = "app.simulation")
public record SimulationProperties(
        boolean enabled,
        @DecimalMin("0") double timeScale,
        boolean autoGenerate,
        @DecimalMin("0") double shipmentsPerHour,
        boolean autoDispatch,
        @NotNull Duration autoDispatchEvery,
        @NotNull Duration consolidationWait,
        @DecimalMin("0") @DecimalMax("1") double fillThreshold,
        @NotNull Duration loadingTime,
        @DecimalMin("0") @DecimalMax("1") double delayRate,
        @DecimalMin("0") @DecimalMax("1") double exceptionRate) {
}
