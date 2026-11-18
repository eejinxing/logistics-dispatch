package com.example.logistics.report;

import com.example.logistics.common.PageView;
import com.example.logistics.dashboard.DashboardView.DirectionCount;
import com.example.logistics.geo.Direction;
import com.example.logistics.hub.Hub;
import com.example.logistics.hub.HubRepository;
import com.example.logistics.shipment.ShipmentFilter;
import com.example.logistics.shipment.ShipmentRepository;
import com.example.logistics.shipment.ShipmentService;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.shipment.ShipmentView;
import com.example.logistics.simulation.SimulationClock;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class ReportService {
    private static final int EXPORT_PAGE = 500;
    private static final int EXPORT_LIMIT = 20_000;
    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final ShipmentRepository shipments;
    private final HubRepository hubs;
    private final ShipmentService shipmentService;
    private final SimulationClock clock;

    public ReportService(ShipmentRepository shipments, HubRepository hubs, ShipmentService shipmentService,
                         SimulationClock clock) {
        this.shipments = shipments;
        this.hubs = hubs;
        this.shipmentService = shipmentService;
        this.clock = clock;
    }

    public record DailyReport(Instant generatedAt, List<Day> days, Totals totals, List<DirectionCount> directions,
                              List<HubRow> hubs) {
    }

    public record Day(LocalDate date, long created, long delivered, long deliveredLate, BigDecimal revenue,
                      double onTimeRate) {
    }

    public record Totals(long created, long delivered, BigDecimal revenue, double onTimeRate, double avgWeightKg) {
    }

    public record HubRow(Long hubId, String code, String name, long outbound, long inbound, BigDecimal revenue) {
    }

    @Transactional(readOnly = true)
    public DailyReport daily(int days) {
        int span = Math.clamp(days, 1, 31);
        ZoneId zone = clock.getZone();
        Instant now = clock.instant();
        LocalDate today = now.atZone(zone).toLocalDate();
        LocalDate first = today.minusDays(span - 1L);
        Instant since = first.atStartOfDay(zone).toInstant();

        Map<LocalDate, long[]> counts = new LinkedHashMap<>();
        Map<LocalDate, BigDecimal> revenue = new LinkedHashMap<>();
        for (LocalDate d = first; !d.isAfter(today); d = d.plusDays(1)) {
            counts.put(d, new long[3]);
            revenue.put(d, BigDecimal.ZERO);
        }
        Map<Direction, double[]> byDirection = new EnumMap<>(Direction.class);
        Map<Long, Object[]> byHub = new LinkedHashMap<>();
        for (Hub h : hubs.findAllByOrderByIdAsc()) {
            byHub.put(h.getId(), new Object[]{h, 0L, 0L, BigDecimal.ZERO});
        }

        long createdTotal = 0;
        double weightTotal = 0;
        for (Object[] row : shipments.reportRows(since)) {
            Instant createdAt = (Instant) row[0];
            BigDecimal price = (BigDecimal) row[1];
            ShipmentStatus status = (ShipmentStatus) row[2];
            Instant deliveredAt = (Instant) row[3];
            Instant promisedBy = (Instant) row[4];
            Direction direction = (Direction) row[5];
            Long originId = (Long) row[6];
            Long destinationId = (Long) row[7];
            double weight = ((Number) row[8]).doubleValue();

            if (!createdAt.isBefore(since) && status != ShipmentStatus.CANCELLED) {
                LocalDate day = createdAt.atZone(zone).toLocalDate();
                counts.get(day)[0]++;
                revenue.merge(day, price, BigDecimal::add);
                byDirection.computeIfAbsent(direction, k -> new double[2])[0]++;
                byDirection.get(direction)[1] += weight;
                createdTotal++;
                weightTotal += weight;
                Object[] o = byHub.get(originId);
                if (o != null) {
                    o[1] = (Long) o[1] + 1;
                    o[3] = ((BigDecimal) o[3]).add(price);
                }
                Object[] d = byHub.get(destinationId);
                if (d != null) {
                    d[2] = (Long) d[2] + 1;
                }
            }
            if (status == ShipmentStatus.DELIVERED && deliveredAt != null && !deliveredAt.isBefore(since)) {
                long[] c = counts.get(deliveredAt.atZone(zone).toLocalDate());
                if (c != null) {
                    c[1]++;
                    if (deliveredAt.isAfter(promisedBy)) {
                        c[2]++;
                    }
                }
            }
        }

        List<Day> dayRows = new ArrayList<>();
        long deliveredTotal = 0;
        long lateTotal = 0;
        BigDecimal revenueTotal = BigDecimal.ZERO;
        for (Map.Entry<LocalDate, long[]> e : counts.entrySet()) {
            long[] c = e.getValue();
            BigDecimal r = revenue.get(e.getKey()).setScale(2, RoundingMode.HALF_UP);
            dayRows.add(new Day(e.getKey(), c[0], c[1], c[2], r, c[1] == 0 ? 1.0 : (c[1] - c[2]) / (double) c[1]));
            deliveredTotal += c[1];
            lateTotal += c[2];
            revenueTotal = revenueTotal.add(r);
        }
        List<DirectionCount> directions = Arrays.stream(Direction.values()).map(d -> {
            double[] v = byDirection.getOrDefault(d, new double[2]);
            return new DirectionCount(d, d.label(), (long) v[0], Math.round(v[1] * 10) / 10.0);
        }).toList();
        List<HubRow> hubRows = byHub.values().stream()
                .map(o -> {
                    Hub h = (Hub) o[0];
                    return new HubRow(h.getId(), h.getCode(), h.getName(), (Long) o[1], (Long) o[2],
                            ((BigDecimal) o[3]).setScale(2, RoundingMode.HALF_UP));
                })
                .sorted(Comparator.comparingLong(HubRow::outbound).reversed())
                .toList();
        Totals totals = new Totals(createdTotal, deliveredTotal, revenueTotal,
                deliveredTotal == 0 ? 1.0 : (deliveredTotal - lateTotal) / (double) deliveredTotal,
                createdTotal == 0 ? 0 : Math.round(weightTotal / createdTotal * 10) / 10.0);
        return new DailyReport(now, dayRows, totals, directions, hubRows);
    }

    public byte[] exportCsv(ShipmentFilter filter) {
        ZoneId zone = clock.getZone();
        StringBuilder csv = new StringBuilder("﻿");
        csv.append("Tracking number,Status,Origin,Destination,Direction,Priority,Weight (kg),Distance (km),Shipping fee (RM),Sender,Recipient,Phone,Created at,Promised delivery,Delivered at,Overdue,Trip,Plate number\n");
        int page = 0;
        int written = 0;
        while (written < EXPORT_LIMIT) {
            PageView<ShipmentView> chunk = shipmentService.search(filter, page++, EXPORT_PAGE);
            for (ShipmentView s : chunk.items()) {
                csv.append(String.join(",",
                        cell(s.trackingNo()), cell(s.statusLabel()), cell(s.origin().code()), cell(s.destination().code()),
                        cell(s.directionLabel()), cell(s.priorityLabel()), cell(String.valueOf(s.weightKg())),
                        cell(String.valueOf(s.distanceKm())), cell(s.price().toPlainString()), cell(s.senderName()),
                        cell(s.receiverName()), cell(s.receiverPhone()), time(s.createdAt(), zone),
                        time(s.promisedBy(), zone), time(s.deliveredAt(), zone), s.late() ? "Yes" : "No",
                        cell(s.tripCode()), cell(s.plateNo())))
                        .append('\n');
                written++;
            }
            if (page >= chunk.totalPages()) {
                break;
            }
        }
        return csv.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    private static String time(Instant t, ZoneId zone) {
        return t == null ? "" : TS.format(t.atZone(zone));
    }

    private static String cell(String value) {
        if (value == null) {
            return "";
        }
        String v = value;
        if (!v.isEmpty() && "=+-@".indexOf(v.charAt(0)) >= 0) {
            v = "'" + v;
        }
        return "\"" + v.replace("\"", "\"\"") + "\"";
    }
}
