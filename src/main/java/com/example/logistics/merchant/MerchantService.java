package com.example.logistics.merchant;

import com.example.logistics.account.AppUser;
import com.example.logistics.account.AppUserRepository;
import com.example.logistics.account.Role;
import com.example.logistics.common.BusinessException;
import com.example.logistics.common.CodeGenerator;
import com.example.logistics.common.NotFoundException;
import com.example.logistics.dashboard.DashboardView.DirectionCount;
import com.example.logistics.dashboard.DashboardView.LaneVolume;
import com.example.logistics.dashboard.DashboardView.StatusCount;
import com.example.logistics.geo.Direction;
import com.example.logistics.hub.Hub;
import com.example.logistics.hub.HubRepository;
import com.example.logistics.shipment.ShipmentFilter;
import com.example.logistics.shipment.ShipmentRepository;
import com.example.logistics.shipment.ShipmentService;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.simulation.SimulationClock;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class MerchantService {
    private final MerchantRepository merchants;
    private final HubRepository hubs;
    private final ShipmentRepository shipments;
    private final ShipmentService shipmentService;
    private final AppUserRepository users;
    private final PasswordEncoder encoder;
    private final CodeGenerator codes;
    private final SimulationClock clock;

    public MerchantService(MerchantRepository merchants, HubRepository hubs, ShipmentRepository shipments,
                           ShipmentService shipmentService, AppUserRepository users, PasswordEncoder encoder,
                           CodeGenerator codes, SimulationClock clock) {
        this.merchants = merchants;
        this.hubs = hubs;
        this.shipments = shipments;
        this.shipmentService = shipmentService;
        this.users = users;
        this.encoder = encoder;
        this.codes = codes;
        this.clock = clock;
    }

    public record CreateMerchantRequest(
            @NotBlank(message = "Enter a merchant name") @Size(max = 80) String name,
            @Size(max = 60) String contactName,
            @Size(max = 30) String phone,
            @NotNull(message = "Select a collection hub") Long defaultHubId,
            @NotBlank(message = "Enter a sign-in username")
            @Pattern(regexp = "[A-Za-z0-9_.-]{3,30}", message = "Username must contain 3-30 letters, digits, underscores, periods, or hyphens") String username,
            @NotBlank @Size(min = 6, max = 64, message = "Password must be at least 6 characters long") String password) {
    }

    @Transactional(readOnly = true)
    public List<MerchantView> list() {
        Instant since = clock.instant().minus(Duration.ofDays(30));
        Map<Long, Long> total = toMap(shipments.countPerMerchant());
        Map<Long, Long> active = toMap(shipments.countPerMerchant(ShipmentStatus.ACTIVE));
        Map<Long, BigDecimal> revenue = new HashMap<>();
        for (Object[] row : shipments.revenuePerMerchant(ShipmentStatus.CANCELLED, since)) {
            revenue.put((Long) row[0], (BigDecimal) row[1]);
        }
        Map<Long, List<String>> logins = new HashMap<>();
        for (Object[] row : users.merchantUsernames()) {
            logins.computeIfAbsent((Long) row[0], k -> new ArrayList<>()).add((String) row[1]);
        }
        return merchants.findAllWithHub().stream()
                .map(m -> MerchantView.from(m, total.getOrDefault(m.getId(), 0L), active.getOrDefault(m.getId(), 0L),
                        revenue.getOrDefault(m.getId(), BigDecimal.ZERO), logins.getOrDefault(m.getId(), List.of())))
                .toList();
    }

    @Transactional
    public MerchantView create(CreateMerchantRequest request) {
        String name = request.name().trim();
        if (merchants.existsByNameIgnoreCase(name)) {
            throw new BusinessException("Merchant " + name + " already exists");
        }
        if (users.existsByUsernameIgnoreCase(request.username().trim())) {
            throw new BusinessException("Username " + request.username().trim() + " is already in use");
        }
        Hub hub = hubs.findById(request.defaultHubId())
                .orElseThrow(() -> new NotFoundException("Hub not found: " + request.defaultHubId()));
        Instant now = clock.instant();
        Merchant merchant = merchants.save(new Merchant(codes.nextMerchantCode(), name, blank(request.contactName()),
                blank(request.phone()), hub, now));
        users.save(new AppUser(request.username().trim(), encoder.encode(request.password()), Role.MERCHANT,
                request.contactName() == null || request.contactName().isBlank() ? name : request.contactName().trim(),
                merchant, blank(request.phone()), now));
        return MerchantView.from(merchant, 0, 0, BigDecimal.ZERO, List.of(request.username().trim()));
    }

    @Transactional
    public MerchantView setActive(long id, boolean active) {
        Merchant m = merchants.findWithHub(id).orElseThrow(() -> new NotFoundException("Merchant not found: " + id));
        m.setActive(active);
        return MerchantView.from(m, 0, 0, BigDecimal.ZERO, List.of());
    }

    @Transactional(readOnly = true)
    public MerchantView profile(long merchantId) {
        return list().stream().filter(m -> m.id() == merchantId).findFirst()
                .orElseThrow(() -> new NotFoundException("Merchant not found: " + merchantId));
    }

    @Transactional(readOnly = true)
    public MerchantDashboard dashboard(long merchantId) {
        Instant now = clock.instant();
        Instant dayStart = now.atZone(clock.getZone()).toLocalDate().atStartOfDay(clock.getZone()).toInstant();
        Instant monthAgo = now.minus(Duration.ofDays(30));

        Map<ShipmentStatus, Long> byStatus = new EnumMap<>(ShipmentStatus.class);
        for (Object[] row : shipments.countByStatus(merchantId)) {
            byStatus.put((ShipmentStatus) row[0], (Long) row[1]);
        }
        List<StatusCount> statuses = Arrays.stream(ShipmentStatus.values())
                .map(s -> new StatusCount(s, s.label(), byStatus.getOrDefault(s, 0L))).toList();

        EnumSet<ShipmentStatus> notCancelled = EnumSet.complementOf(EnumSet.of(ShipmentStatus.CANCELLED));
        Map<Direction, Object[]> dirRows = new EnumMap<>(Direction.class);
        for (Object[] row : shipments.countByDirection(notCancelled, null, merchantId)) {
            dirRows.put((Direction) row[0], row);
        }
        List<DirectionCount> directions = Arrays.stream(Direction.values()).map(d -> {
            Object[] r = dirRows.get(d);
            return r == null ? new DirectionCount(d, d.label(), 0, 0)
                    : new DirectionCount(d, d.label(), (Long) r[1], ((Number) r[2]).doubleValue());
        }).toList();
        List<LaneVolume> lanes = shipments.laneVolumes(notCancelled, null, merchantId, PageRequest.of(0, 30)).stream()
                .map(r -> {
                    Direction d = (Direction) r[2];
                    return new LaneVolume((Long) r[0], (Long) r[1], d, d.label(), (Long) r[3], ((Number) r[4]).doubleValue());
                }).toList();

        Object[] today = shipments.createdSince(dayStart, ShipmentStatus.CANCELLED, merchantId).getFirst();
        Object[] month = shipments.createdSince(monthAgo, ShipmentStatus.CANCELLED, merchantId).getFirst();
        Object[] delivered = shipments.deliveredSince(monthAgo, ShipmentStatus.DELIVERED, merchantId).getFirst();
        long deliveredCount = ((Number) delivered[0]).longValue();
        long onTime = ((Number) delivered[1]).longValue();

        var recent = shipmentService.search(
                new ShipmentFilter(null, null, null, null, null, null, null, null, merchantId), 0, 8).items();
        return new MerchantDashboard(now, profile(merchantId), statuses, directions, lanes,
                ((Number) today[0]).longValue(), money(today[1]), ((Number) month[0]).longValue(), money(month[1]),
                deliveredCount, deliveredCount == 0 ? 1.0 : onTime / (double) deliveredCount,
                shipments.countLate(ShipmentStatus.ACTIVE, now, merchantId), recent);
    }

    private static Map<Long, Long> toMap(List<Object[]> rows) {
        Map<Long, Long> map = new HashMap<>();
        for (Object[] row : rows) {
            map.put((Long) row[0], (Long) row[1]);
        }
        return map;
    }

    private static BigDecimal money(Object value) {
        return value instanceof BigDecimal bd ? bd : new BigDecimal(String.valueOf(value == null ? 0 : value));
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
