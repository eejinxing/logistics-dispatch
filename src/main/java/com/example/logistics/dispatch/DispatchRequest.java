package com.example.logistics.dispatch;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record DispatchRequest(
        @NotNull(message = "Select a vehicle") Long vehicleId,
        @NotEmpty(message = "Select at least one shipment") @Size(max = 500) List<@NotNull Long> shipmentIds) {
}
