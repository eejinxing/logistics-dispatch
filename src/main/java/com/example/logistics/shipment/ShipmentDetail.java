package com.example.logistics.shipment;

import com.example.logistics.dispatch.TripView;

import java.time.Instant;
import java.util.List;

public record ShipmentDetail(ShipmentView shipment, TripView trip, List<Event> events) {

    public record Event(ShipmentStatus status, String statusLabel, String location, String note, Instant occurredAt) {
        public static Event from(TrackingEvent e) {
            return new Event(e.getStatus(), e.getStatus().label(), e.getLocation(), e.getNote(), e.getOccurredAt());
        }
    }
}
