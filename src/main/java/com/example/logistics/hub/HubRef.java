package com.example.logistics.hub;

public record HubRef(Long id, String code, String name, double lat, double lng) {
    public static HubRef from(Hub hub) {
        return new HubRef(hub.getId(), hub.getCode(), hub.getName(), hub.getLat(), hub.getLng());
    }
}
