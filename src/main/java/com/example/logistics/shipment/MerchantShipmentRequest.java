package com.example.logistics.shipment;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record MerchantShipmentRequest(
        Long originId,
        @NotNull(message = "Select a destination hub") Long destinationId,
        @NotBlank(message = "Enter a recipient name") @Size(max = 80) String receiverName,
        @NotBlank(message = "Enter the recipient phone number used for parcel tracking") @Size(max = 30) String receiverPhone,
        @Size(max = 200) String receiverAddress,
        @NotNull(message = "Enter the weight")
        @DecimalMin(value = "0.1", message = "Weight must be at least 0.1 kg")
        @DecimalMax(value = "5000", message = "Weight per shipment cannot exceed 5000 kg") Double weightKg,
        Priority priority) {

    public Priority priorityOrDefault() {
        return priority == null ? Priority.STANDARD : priority;
    }
}
