package com.example.logistics.dispatch;

import com.example.logistics.TestData;
import com.example.logistics.hub.Hub;
import com.example.logistics.hub.RoutePlanner;
import com.example.logistics.shipment.CreateShipmentRequest;
import com.example.logistics.shipment.Priority;
import com.example.logistics.shipment.QuoteRequest;
import com.example.logistics.shipment.ShipmentService;
import com.example.logistics.vehicle.Vehicle;
import com.example.logistics.vehicle.VehicleRepository;
import com.example.logistics.vehicle.VehicleType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = {"app.seed.enabled=false", "app.simulation.enabled=false"})
@Import(TestData.class)
class TransferRoutingTest {
    @Autowired
    TestData data;
    @Autowired
    RoutePlanner routes;
    @Autowired
    ShipmentService shipments;
    @Autowired
    DispatchService dispatch;
    @Autowired
    VehicleRepository vehicles;

    Hub kl;
    Hub penang;
    Hub kuching;

    @BeforeEach
    void setUp() {
        data.reset();
        kl = data.kualaLumpur();
        penang = data.penang();
        kuching = data.kuching();
    }

    @Test
    void crossSeaPathsGoThroughTheGateway() {
        assertThat(routes.path(penang, kuching)).extracting(Hub::getCode).containsExactly("PEN", "KUL", "KCH");
        assertThat(routes.path(kuching, penang)).extracting(Hub::getCode).containsExactly("KCH", "KUL", "PEN");
        assertThat(routes.path(kl, kuching)).extracting(Hub::getCode).containsExactly("KUL", "KCH");
        assertThat(routes.path(penang, kl)).extracting(Hub::getCode).containsExactly("PEN", "KUL");
    }

    @Test
    void quoteShowsTheTransferRoute() {
        var quote = shipments.quote(new QuoteRequest(penang.getId(), kuching.getId(), 50.0, Priority.STANDARD));
        assertThat(quote.route()).containsExactly("PEN", "KUL", "KCH");
        assertThat(quote.air()).isTrue();
        assertThat(quote.mode()).contains("transfer");
    }

    @Test
    void penangToKuchingAndPenangToKlShareOneTruckToTheGateway() {
        vehicles.save(new Vehicle("PAA 1111", VehicleType.LORRY, 5_000, "Driver", null, penang));
        long toKuching = shipments.create(new CreateShipmentRequest(penang.getId(), kuching.getId(), "S", "R1", null,
                null, 100.0, Priority.STANDARD, null)).id();
        long toKl = shipments.create(new CreateShipmentRequest(penang.getId(), kl.getId(), "S", "R2", null,
                null, 100.0, Priority.STANDARD, null)).id();

        List<LaneView> lanes = dispatch.pendingLanes();
        assertThat(lanes).hasSize(1);
        LaneView lane = lanes.getFirst();
        assertThat(lane.origin().code()).isEqualTo("PEN");
        assertThat(lane.destination().code()).isEqualTo("KUL");
        assertThat(lane.air()).isFalse();
        assertThat(lane.count()).isEqualTo(2);
        assertThat(lane.transferCount()).isEqualTo(1);

        Vehicle truck = vehicles.findAll().getFirst();
        TripView trip = dispatch.dispatch(new DispatchRequest(truck.getId(), List.of(toKuching, toKl)));
        assertThat(trip.destination().code()).isEqualTo("KUL");
        assertThat(trip.shipmentCount()).isEqualTo(2);
    }
}
