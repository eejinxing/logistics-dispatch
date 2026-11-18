package com.example.logistics.dispatch;

import java.time.Instant;
import java.util.List;

public record AutoDispatchResult(
        Instant at,
        int hubsScanned,
        int workers,
        int tripsCreated,
        int shipmentsAssigned,
        List<TripView> trips,
        List<String> waiting,
        List<String> relocations,
        List<String> problems,
        long elapsedMs) {

    static AutoDispatchResult empty(Instant at) {
        return new AutoDispatchResult(at, 0, 0, 0, 0, List.of(), List.of(), List.of(), List.of(), 0);
    }

    static AutoDispatchResult of(Instant at, int hubsScanned, int workers, List<HubOutcome> outcomes,
                                 List<String> relocations, long elapsedMs) {
        List<TripView> trips = outcomes.stream().flatMap(o -> o.trips().stream()).toList();
        return new AutoDispatchResult(at, hubsScanned, workers, trips.size(),
                trips.stream().mapToInt(TripView::shipmentCount).sum(), trips,
                outcomes.stream().flatMap(o -> o.waiting().stream()).toList(),
                relocations,
                outcomes.stream().filter(o -> o.error() != null).map(o -> o.hubCode() + ": " + o.error()).toList(),
                elapsedMs);
    }

    record HubOutcome(long hubId, String hubCode, List<TripView> trips, List<String> waiting,
                      List<VehicleNeed> needs, String error) {
        static HubOutcome failed(long hubId, String hubCode, String error) {
            return new HubOutcome(hubId, hubCode, List.of(), List.of(), List.of(), error);
        }
    }

    record VehicleNeed(long hubId, String hubCode, boolean air, String lane) {
    }
}
