package com.example.logistics.hub;

public record HubView(
        Long id,
        String code,
        String name,
        String state,
        Landmass landmass,
        String landmassLabel,
        double lat,
        double lng,
        long vehiclesTotal,
        long vehiclesIdle,
        long pendingOutbound,
        long activeOutbound,
        long activeInbound) {

    public static HubView from(Hub hub, long vehiclesTotal, long vehiclesIdle, long pendingOutbound,
                               long activeOutbound, long activeInbound) {
        return new HubView(hub.getId(), hub.getCode(), hub.getName(), hub.getState(), hub.getLandmass(),
                hub.getLandmass().label(), hub.getLat(), hub.getLng(), vehiclesTotal, vehiclesIdle,
                pendingOutbound, activeOutbound, activeInbound);
    }
}
