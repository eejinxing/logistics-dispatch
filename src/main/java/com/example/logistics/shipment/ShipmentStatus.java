package com.example.logistics.shipment;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

public enum ShipmentStatus {
    CREATED("Awaiting dispatch"),
    ASSIGNED("Loaded"),
    IN_TRANSIT("In transit"),
    AT_TRANSFER("Awaiting transfer"),
    ARRIVED_HUB("At destination hub"),
    OUT_FOR_DELIVERY("Out for delivery"),
    DELIVERED("Delivered"),
    EXCEPTION("Exception"),
    CANCELLED("Cancelled");

    public static final Set<ShipmentStatus> ACTIVE = Collections.unmodifiableSet(
            EnumSet.of(CREATED, ASSIGNED, IN_TRANSIT, AT_TRANSFER, ARRIVED_HUB, OUT_FOR_DELIVERY, EXCEPTION));
    public static final Set<ShipmentStatus> MOVING = Collections.unmodifiableSet(
            EnumSet.of(ASSIGNED, IN_TRANSIT, AT_TRANSFER, ARRIVED_HUB, OUT_FOR_DELIVERY, EXCEPTION));
    public static final Set<ShipmentStatus> WAITING = Collections.unmodifiableSet(EnumSet.of(CREATED, AT_TRANSFER));

    private static final Map<ShipmentStatus, Set<ShipmentStatus>> NEXT = new EnumMap<>(ShipmentStatus.class);

    static {
        NEXT.put(CREATED, EnumSet.of(ASSIGNED, CANCELLED));
        NEXT.put(ASSIGNED, EnumSet.of(IN_TRANSIT, CANCELLED));
        NEXT.put(IN_TRANSIT, EnumSet.of(ARRIVED_HUB, AT_TRANSFER, EXCEPTION));
        NEXT.put(AT_TRANSFER, EnumSet.of(ASSIGNED, EXCEPTION));
        NEXT.put(ARRIVED_HUB, EnumSet.of(OUT_FOR_DELIVERY, EXCEPTION));
        NEXT.put(OUT_FOR_DELIVERY, EnumSet.of(DELIVERED, EXCEPTION));
        NEXT.put(EXCEPTION, EnumSet.of(IN_TRANSIT, AT_TRANSFER, OUT_FOR_DELIVERY, CANCELLED));
        NEXT.put(DELIVERED, EnumSet.noneOf(ShipmentStatus.class));
        NEXT.put(CANCELLED, EnumSet.noneOf(ShipmentStatus.class));
    }

    private final String label;

    ShipmentStatus(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public boolean canMoveTo(ShipmentStatus next) {
        return NEXT.get(this).contains(next);
    }

    public boolean isTerminal() {
        return this == DELIVERED || this == CANCELLED;
    }

    public boolean isWaiting() {
        return WAITING.contains(this);
    }
}
