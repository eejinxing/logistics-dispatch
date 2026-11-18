package com.example.logistics.dispatch;

import com.example.logistics.TestData;
import com.example.logistics.common.BusinessException;
import com.example.logistics.hub.Hub;
import com.example.logistics.shipment.CreateShipmentRequest;
import com.example.logistics.shipment.Priority;
import com.example.logistics.shipment.Shipment;
import com.example.logistics.shipment.ShipmentRepository;
import com.example.logistics.shipment.ShipmentService;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.vehicle.Vehicle;
import com.example.logistics.vehicle.VehicleRepository;
import com.example.logistics.vehicle.VehicleType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = {"app.seed.enabled=false", "app.simulation.enabled=false"})
@Import(TestData.class)
class DispatchConcurrencyTest {
    @Autowired
    TestData data;
    @Autowired
    VehicleRepository vehicles;
    @Autowired
    ShipmentRepository shipments;
    @Autowired
    TripRepository trips;
    @Autowired
    ShipmentService shipmentService;
    @Autowired
    DispatchService dispatch;

    Hub kl;
    Hub penang;
    Vehicle van;

    @BeforeEach
    void setUp() {
        data.reset();
        kl = data.kualaLumpur();
        penang = data.penang();
        van = vehicles.save(new Vehicle("WAA 1111", VehicleType.VAN, 1_000, "Driver One", null, kl));
    }

    private List<Long> createShipments(int count, double kg) {
        return IntStream.range(0, count)
                .mapToObj(i -> shipmentService.create(new CreateShipmentRequest(kl.getId(), penang.getId(), "Sender",
                        "Receiver " + i, null, null, kg, Priority.STANDARD, null)).id())
                .toList();
    }

    @Test
    void eightDispatchersRacingForOneVanBookItExactlyOnce() throws Exception {
        List<Long> ids = createShipments(12, 150);
        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Boolean>> results = new ArrayList<>();
        for (int t = 0; t < threads; t++) {
            List<Long> shuffled = new ArrayList<>(ids);
            Collections.shuffle(shuffled, new Random(t));
            List<Long> subset = List.copyOf(shuffled.subList(0, 6));
            results.add(pool.submit(() -> {
                go.await();
                try {
                    dispatch.dispatch(new DispatchRequest(van.getId(), subset));
                    return true;
                } catch (BusinessException e) {
                    return false;
                }
            }));
        }
        go.countDown();
        int succeeded = 0;
        for (Future<Boolean> f : results) {
            if (f.get(20, TimeUnit.SECONDS)) {
                succeeded++;
            }
        }
        pool.shutdown();

        assertThat(succeeded).isEqualTo(1);
        List<Trip> all = trips.findAll();
        assertThat(all).hasSize(1);
        assertThat(all.getFirst().getLoadKg()).isEqualTo(900.0);
        assertThat(shipments.findAll()).filteredOn(s -> s.getStatus() == ShipmentStatus.ASSIGNED).hasSize(6);
    }

    @Test
    void concurrentAutoDispatchRunsNeverAssignAParcelTwice() throws Exception {
        vehicles.save(new Vehicle("WBB 2222", VehicleType.LORRY, 5_000, "Driver Two", null, kl));
        createShipments(20, 100);

        int callers = 6;
        ExecutorService pool = Executors.newFixedThreadPool(callers);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<AutoDispatchResult>> runs = new ArrayList<>();
        for (int i = 0; i < callers; i++) {
            runs.add(pool.submit(() -> {
                go.await();
                return dispatch.autoDispatch().get(20, TimeUnit.SECONDS);
            }));
        }
        go.countDown();
        for (Future<AutoDispatchResult> run : runs) {
            run.get(30, TimeUnit.SECONDS);
        }
        pool.shutdown();

        List<Trip> all = trips.findAll();
        assertThat(all).hasSize(1);
        List<Shipment> assigned = shipments.findAll().stream()
                .filter(s -> s.getStatus() == ShipmentStatus.ASSIGNED).toList();
        assertThat(assigned).hasSize(10);
        assertThat(all.getFirst().getLoadKg()).isEqualTo(1_000.0);
    }
}
