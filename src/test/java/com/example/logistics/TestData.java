package com.example.logistics;

import com.example.logistics.account.AppUserRepository;
import com.example.logistics.dispatch.TripRepository;
import com.example.logistics.hub.Hub;
import com.example.logistics.hub.HubRepository;
import com.example.logistics.hub.Landmass;
import com.example.logistics.merchant.MerchantRepository;
import com.example.logistics.shipment.ShipmentRepository;
import com.example.logistics.shipment.TrackingEventRepository;
import com.example.logistics.vehicle.VehicleRepository;
import org.springframework.stereotype.Component;

@Component
public class TestData {
    private final HubRepository hubs;
    private final VehicleRepository vehicles;
    private final ShipmentRepository shipments;
    private final TripRepository trips;
    private final TrackingEventRepository events;
    private final MerchantRepository merchants;
    private final AppUserRepository users;

    public TestData(HubRepository hubs, VehicleRepository vehicles, ShipmentRepository shipments,
                    TripRepository trips, TrackingEventRepository events, MerchantRepository merchants,
                    AppUserRepository users) {
        this.hubs = hubs;
        this.vehicles = vehicles;
        this.shipments = shipments;
        this.trips = trips;
        this.events = events;
        this.merchants = merchants;
        this.users = users;
    }

    public void reset() {
        events.deleteAllInBatch();
        shipments.deleteAllInBatch();
        trips.deleteAllInBatch();
        vehicles.deleteAllInBatch();
        users.deleteNonAdmins();
        merchants.deleteAllInBatch();
        hubs.deleteAllInBatch();
    }

    public Hub kualaLumpur() {
        return hubs.save(new Hub("KUL", "Kuala Lumpur", "Wilayah Persekutuan", Landmass.PENINSULAR, 3.1390, 101.6869, 1));
    }

    public Hub penang() {
        return hubs.save(new Hub("PEN", "Penang", "Pulau Pinang", Landmass.PENINSULAR, 5.4141, 100.3288, 1));
    }

    public Hub kuching() {
        return hubs.save(new Hub("KCH", "Kuching", "Sarawak", Landmass.BORNEO, 1.5535, 110.3593, 1));
    }
}
