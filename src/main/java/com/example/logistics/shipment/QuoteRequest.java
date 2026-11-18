package com.example.logistics.shipment;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

public record QuoteRequest(
        @NotNull(message = "Select an origin hub") Long originId,
        @NotNull(message = "Select a destination hub") Long destinationId,
        @NotNull(message = "Enter the weight")
        @DecimalMin(value = "0.1", message = "Weight must be at least 0.1 kg")
        @DecimalMax(value = "5000", message = "Weight per shipment cannot exceed 5000 kg") Double weightKg,
        Priority priority) {

    public Priority priorityOrDefault() {
        return priority == null ? Priority.STANDARD : priority;
    }
}
