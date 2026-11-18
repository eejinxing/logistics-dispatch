package com.example.logistics.seed;

import com.example.logistics.merchant.Merchant;
import com.example.logistics.merchant.MerchantRepository;
import com.example.logistics.common.CodeGenerator;
import com.example.logistics.config.SeedProperties;
import com.example.logistics.config.SimulationProperties;
import com.example.logistics.dispatch.Trip;
import com.example.logistics.dispatch.TripRepository;
import com.example.logistics.hub.Hub;
import com.example.logistics.hub.HubRepository;
import com.example.logistics.hub.Landmass;
import com.example.logistics.hub.Routes;
import com.example.logistics.shipment.Priority;
import com.example.logistics.shipment.PricingService;
import com.example.logistics.shipment.QuoteView;
import com.example.logistics.shipment.Shipment;
import com.example.logistics.shipment.ShipmentJournal;
import com.example.logistics.shipment.ShipmentRepository;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.simulation.SimulationClock;
import com.example.logistics.vehicle.DriverAssignment;
import com.example.logistics.vehicle.Vehicle;
import com.example.logistics.vehicle.VehicleRepository;
import com.example.logistics.vehicle.VehicleType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.stream.IntStream;

@Component
@ConditionalOnProperty(prefix = "app.seed", name = "enabled", havingValue = "true", matchIfMissing = true)
public class DataSeeder implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);
    private static final List<String> EXCEPTION_REASONS = List.of("Recipient unavailable", "Incomplete address", "Recipient refused delivery", "Damaged packaging");
    private static final List<String> PORTRAIT_DRIVERS = List.of(
            "Ahmad Faizal", "Nurul Huda", "Tan Wei Ming", "Kavitha Devi",
            "Chong Mei Ling", "Mohd Hafiz", "Goh Siew Lan", "Lim Chee Keong",
            "Muthu Raj", "Aisyah Rahman", "Wong Kah Leong", "Farid Ismail",
            "Ng Pei Shan", "Hairul Anuar", "Siva Kumar", "Faridah Ali");

    private static final Map<String, String> PLATE_PREFIX = Map.ofEntries(
            Map.entry("KUL", "W"), Map.entry("PEN", "P"), Map.entry("JHB", "J"), Map.entry("IPH", "A"),
            Map.entry("MKZ", "M"), Map.entry("SRB", "N"), Map.entry("KUA", "C"), Map.entry("AOR", "K"),
            Map.entry("KBR", "D"), Map.entry("TGG", "T"), Map.entry("KCH", "QA"), Map.entry("BKI", "SA"));

    private final SeedProperties props;
    private final SimulationProperties sim;
    private final HubRepository hubs;
    private final VehicleRepository vehicles;
    private final TripRepository trips;
    private final ShipmentRepository shipments;
    private final ShipmentJournal journal;
    private final PricingService pricing;
    private final CodeGenerator codes;
    private final SimulationClock clock;
    private final TransactionTemplate tx;

    private final MerchantRepository merchants;
    private List<Merchant> merchantList = List.of();

    public DataSeeder(SeedProperties props, SimulationProperties sim, HubRepository hubs, VehicleRepository vehicles,
                      TripRepository trips,
                      ShipmentRepository shipments, ShipmentJournal journal, PricingService pricing,
                      CodeGenerator codes, SimulationClock clock, TransactionTemplate tx,
                      MerchantRepository merchants) {
        this.merchants = merchants;
        this.props = props;
        this.sim = sim;
        this.hubs = hubs;
        this.vehicles = vehicles;
        this.trips = trips;
        this.shipments = shipments;
        this.journal = journal;
        this.pricing = pricing;
        this.codes = codes;
        this.clock = clock;
        this.tx = tx;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (hubs.count() > 0) {
            return;
        }
        long started = System.currentTimeMillis();
        tx.executeWithoutResult(status -> seed(new Random(42)));
        log.info("Seeded demo data in {} ms: {} hubs, {} vehicles, {} merchants, {} shipments",
                System.currentTimeMillis() - started, hubs.count(), vehicles.count(), merchants.count(),
                shipments.count());
    }

    private void seed(Random rnd) {
        List<Hub> hubList = seedHubs();
        List<Vehicle> fleet = seedFleet(hubList, rnd);
        Instant now = clock.instant();
        merchantList = seedMerchants(hubList, rnd, now);
        int made = 0;
        int attempts = 0;
        while (made < props.historyShipments() && attempts++ < props.historyShipments() * 4) {
            if (seedHistoric(hubList, fleet, rnd, now)) {
                made++;
            }
        }
        for (int i = 0; i < props.pendingShipments(); i++) {
            Instant createdAt = now.minus(Duration.ofMinutes(rnd.nextInt(5, 5 * 60)));
            Shipment s = newShipment(hubList, rnd, createdAt);
            journal.recordQuietly(s, s.getOrigin().getName(), "Collected and awaiting dispatch", createdAt);
        }
    }

    private List<Merchant> seedMerchants(List<Hub> hubList, Random rnd, Instant now) {
        List<Merchant> list = new ArrayList<>();
        for (String name : FakeData.companies()) {
            Hub home = FakeData.weightedHub(hubList, null, rnd);
            list.add(new Merchant(codes.nextMerchantCode(), name, FakeData.person(rnd), FakeData.phone(rnd), home,
                    now.minus(Duration.ofDays(rnd.nextInt(30, 400)))));
        }
        return merchants.saveAll(list);
    }

    private List<Hub> seedHubs() {
        return hubs.saveAll(List.of(
                new Hub("KUL", "Kuala Lumpur", "Wilayah Persekutuan", Landmass.PENINSULAR, 3.1390, 101.6869, 10),
                new Hub("PEN", "Penang", "Pulau Pinang", Landmass.PENINSULAR, 5.4141, 100.3288, 6),
                new Hub("JHB", "Johor Bahru", "Johor", Landmass.PENINSULAR, 1.4927, 103.7414, 6),
                new Hub("IPH", "Ipoh", "Perak", Landmass.PENINSULAR, 4.5975, 101.0901, 4),
                new Hub("MKZ", "Melaka", "Melaka", Landmass.PENINSULAR, 2.1896, 102.2501, 3),
                new Hub("SRB", "Seremban", "Negeri Sembilan", Landmass.PENINSULAR, 2.7259, 101.9424, 3),
                new Hub("KUA", "Kuantan", "Pahang", Landmass.PENINSULAR, 3.8077, 103.3260, 3),
                new Hub("AOR", "Alor Setar", "Kedah", Landmass.PENINSULAR, 6.1248, 100.3678, 2),
                new Hub("KBR", "Kota Bharu", "Kelantan", Landmass.PENINSULAR, 6.1254, 102.2381, 2),
                new Hub("TGG", "Kuala Terengganu", "Terengganu", Landmass.PENINSULAR, 5.3296, 103.1370, 2),
                new Hub("KCH", "Kuching", "Sarawak", Landmass.BORNEO, 1.5535, 110.3593, 4),
                new Hub("BKI", "Kota Kinabalu", "Sabah", Landmass.BORNEO, 5.9804, 116.0735, 3)));
    }

    private List<Vehicle> seedFleet(List<Hub> hubList, Random rnd) {
        Map<String, List<VehicleType>> plan = Map.ofEntries(
                Map.entry("KUL", List.of(VehicleType.VAN, VehicleType.VAN, VehicleType.LORRY, VehicleType.LORRY,
                        VehicleType.LORRY, VehicleType.LORRY, VehicleType.TRAILER, VehicleType.AIR_CARGO,
                        VehicleType.AIR_CARGO)),
                Map.entry("PEN", List.of(VehicleType.VAN, VehicleType.LORRY, VehicleType.LORRY, VehicleType.LORRY)),
                Map.entry("JHB", List.of(VehicleType.VAN, VehicleType.LORRY, VehicleType.LORRY, VehicleType.LORRY)),
                Map.entry("IPH", List.of(VehicleType.VAN, VehicleType.LORRY, VehicleType.LORRY)),
                Map.entry("MKZ", List.of(VehicleType.VAN, VehicleType.LORRY)),
                Map.entry("SRB", List.of(VehicleType.VAN, VehicleType.LORRY)),
                Map.entry("KUA", List.of(VehicleType.VAN, VehicleType.LORRY, VehicleType.LORRY)),
                Map.entry("AOR", List.of(VehicleType.LORRY, VehicleType.LORRY)),
                Map.entry("KBR", List.of(VehicleType.VAN, VehicleType.LORRY)),
                Map.entry("TGG", List.of(VehicleType.VAN, VehicleType.LORRY)),
                Map.entry("KCH", List.of(VehicleType.VAN, VehicleType.LORRY, VehicleType.LORRY, VehicleType.AIR_CARGO)),
                Map.entry("BKI", List.of(VehicleType.VAN, VehicleType.LORRY, VehicleType.LORRY, VehicleType.AIR_CARGO)));

        Set<String> plates = new HashSet<>();
        List<Vehicle> fleet = new ArrayList<>();
        LocalDate today = clock.instant().atZone(clock.getZone()).toLocalDate();
        int driverIndex = 0;
        char airSuffix = 'A';
        for (Hub hub : hubList) {
            for (VehicleType type : plan.getOrDefault(hub.getCode(), List.of())) {
                String plate;
                if (type.isAir()) {
                    plate = "9M-MX" + airSuffix++;
                } else {
                    do {
                        plate = plate(PLATE_PREFIX.get(hub.getCode()), rnd);
                    } while (!plates.add(plate));
                }
                int index = driverIndex++;
                int portrait = index % PORTRAIT_DRIVERS.size();
                String driver = (type.isAir() ? "Capt. " : "") + PORTRAIT_DRIVERS.get(portrait);
                Vehicle vehicle = new Vehicle(plate, type, type.defaultCapacityKg(), driver, FakeData.phone(rnd), hub);
                int relief = vehicle.isHeavyDuty() ? 5 + index % 2 : index % 3;
                vehicle.setDriverRoster(portrait, IntStream.rangeClosed(1, relief)
                        .map(i -> (portrait + i * 3) % PORTRAIT_DRIVERS.size())
                        .mapToObj(i -> new DriverAssignment(PORTRAIT_DRIVERS.get(i), i))
                        .toList());
                vehicle.setFleetDetails(vehicle.isHeavyDuty() && index % 3 != 0,
                        today.plusDays(3L + index % 24), type.isAir() ? null : 4 + index % 7);
                fleet.add(vehicle);
            }
        }
        fleet.stream().filter(v -> v.getHub().getCode().equals("PEN") && v.getType() == VehicleType.VAN)
                .findFirst().ifPresent(v -> v.setMaintenance(true));
        return vehicles.saveAll(fleet);
    }

    private static String plate(String prefix, Random rnd) {
        StringBuilder sb = new StringBuilder(prefix);
        while (sb.length() < 3) {
            sb.append((char) ('A' + rnd.nextInt(26)));
        }
        return sb + " " + (1000 + rnd.nextInt(9000));
    }

    private record Order(Merchant merchant, Hub origin, Hub destination, String receiver, String phone) {
    }

    private Order pickOrder(List<Hub> hubList, Random rnd) {
        Merchant merchant = FakeData.pickMerchant(merchantList, rnd);
        Hub origin = FakeData.originFor(merchant, hubList, rnd);
        Hub destination = FakeData.weightedHub(hubList, origin, rnd);
        return new Order(merchant, origin, destination, FakeData.person(rnd), FakeData.phone(rnd));
    }

    private Shipment save(Order order, Random rnd, Instant createdAt) {
        double kg = FakeData.weightKg(rnd);
        Priority priority = FakeData.priority(rnd);
        QuoteView quote = pricing.quote(order.origin(), order.destination(), kg, priority, createdAt);
        return shipments.save(new Shipment(codes.nextTrackingNo(createdAt, clock.getZone()),
                order.merchant().getName(), order.receiver(), order.phone(),
                FakeData.address(order.destination(), rnd), order.origin(), order.destination(), kg, priority,
                quote.direction(), quote.distanceKm(), quote.price(), createdAt, quote.promisedBy(), order.merchant()));
    }

    private Shipment newShipment(List<Hub> hubList, Random rnd, Instant createdAt) {
        return save(pickOrder(hubList, rnd), rnd, createdAt);
    }

    private boolean seedHistoric(List<Hub> hubList, List<Vehicle> fleet, Random rnd, Instant now) {
        long windowMinutes = Duration.ofDays(Math.max(1, props.historyDays())).toMinutes();
        Instant createdAt = now.minus(Duration.ofMinutes(rnd.nextLong(6 * 60, windowMinutes)));

        Order order = pickOrder(hubList, rnd);
        Hub origin = order.origin();
        Hub destination = order.destination();
        boolean air = Routes.requiresAir(origin, destination);
        double km = Routes.distanceKm(origin, destination);

        Instant assigned = createdAt.plus(Duration.ofMinutes(rnd.nextInt(30, 200)));
        Instant departed = assigned.plus(sim.loadingTime());
        Instant arrived = departed.plus(Routes.travelTime(km, air ? VehicleType.AIR_CARGO : VehicleType.LORRY));
        Duration hubDwell = Duration.ofMinutes(rnd.nextInt(60, 180));
        if (rnd.nextDouble() < 0.08) {
            hubDwell = hubDwell.plusHours(rnd.nextInt(18, 40));
        }
        Instant outForDelivery = arrived.plus(hubDwell);
        Instant delivered = outForDelivery.plus(Duration.ofMinutes(rnd.nextInt(60, 240)));

        boolean cancel = rnd.nextDouble() < 0.03;
        if (!cancel && arrived.isAfter(now)) {
            return false;
        }

        Shipment s = save(order, rnd, createdAt);
        journal.recordQuietly(s, origin.getName(), "Collected and awaiting dispatch", createdAt);

        if (cancel) {
            Instant at = createdAt.plus(Duration.ofMinutes(rnd.nextInt(10, 120)));
            s.cancel(at);
            journal.recordQuietly(s, origin.getName(), "Cancelled by the sender", at);
            return true;
        }

        List<Vehicle> eligible = fleet.stream()
                .filter(v -> Routes.canServe(v.getType(), origin, destination) && v.getCapacityKg() >= s.getWeightKg())
                .filter(v -> air || v.getHub().getLandmass() == origin.getLandmass())
                .toList();
        List<Vehicle> local = eligible.stream().filter(v -> v.getHub().sameAs(origin)).toList();
        List<Vehicle> available = local.isEmpty() ? eligible : local;
        Vehicle vehicle = available.get(Math.floorMod(s.getId(), available.size()));
        Trip trip = new Trip(codes.nextTripCode(), vehicle, origin, destination, false, s.getWeightKg(), km,
                assigned, departed, arrived);
        trip.depart();
        trip.arrive(arrived);
        trips.save(trip);
        s.assignTo(trip, assigned);
        trip.getShipments().add(s);
        journal.recordQuietly(s, origin.getName(), "Loaded · " + vehicle.getPlateNo() + " (" + vehicle.getType().label() + ")", assigned);
        s.moveTo(ShipmentStatus.IN_TRANSIT, departed);
        journal.recordQuietly(s, origin.getName(), "Departed " + origin.getCode() + " for " + destination.getCode(), departed);
        s.arriveAt(destination, arrived);
        journal.recordQuietly(s, destination.getName(), "Arrived at " + destination.getCode() + " hub for sorting", arrived);
        if (outForDelivery.isAfter(now)) {
            s.scheduleNextStep(outForDelivery);
            return true;
        }
        s.moveTo(ShipmentStatus.OUT_FOR_DELIVERY, outForDelivery);
        journal.recordQuietly(s, destination.getName(), "Courier is out for delivery", outForDelivery);
        if (delivered.isAfter(now)) {
            s.scheduleNextStep(delivered);
            return true;
        }
        if (rnd.nextDouble() < 0.04) {
            String reason = FakeData.pick(EXCEPTION_REASONS, rnd);
            s.markException(reason, delivered);
            journal.recordQuietly(s, destination.getName(), "Delivery failed: " + reason, delivered);
            return true;
        }
        s.moveTo(ShipmentStatus.DELIVERED, delivered);
        journal.recordQuietly(s, destination.getName(), "Delivered to " + s.getReceiverName(), delivered);
        return true;
    }
}
