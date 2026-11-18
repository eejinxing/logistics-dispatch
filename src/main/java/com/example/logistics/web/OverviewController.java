package com.example.logistics.web;

import com.example.logistics.dashboard.DashboardService;
import com.example.logistics.dashboard.DashboardView;
import com.example.logistics.geo.Direction;
import com.example.logistics.live.LiveEvent;
import com.example.logistics.live.LiveEventHub;
import com.example.logistics.report.ReportService;
import com.example.logistics.shipment.Priority;
import com.example.logistics.shipment.ShipmentFilter;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.simulation.SimulationClock;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

@RestController
public class OverviewController {
    private static final DateTimeFormatter FILE_TS = DateTimeFormatter.ofPattern("yyyyMMdd-HHmm");

    private final DashboardService dashboard;
    private final ReportService reports;
    private final LiveEventHub live;
    private final SimulationClock clock;

    public OverviewController(DashboardService dashboard, ReportService reports, LiveEventHub live,
                              SimulationClock clock) {
        this.dashboard = dashboard;
        this.reports = reports;
        this.live = live;
        this.clock = clock;
    }

    @GetMapping("/api/dashboard")
    public CompletableFuture<DashboardView> dashboard(@RequestParam(required = false) Long originId,
                                                      @RequestParam(defaultValue = "active") String scope) {
        return dashboard.summary(originId, scope);
    }

    @GetMapping(path = "/api/live", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter live() {
        return live.subscribe();
    }

    @GetMapping("/api/events/recent")
    public List<LiveEvent> recentEvents() {
        return live.recent();
    }

    @GetMapping("/api/reports/daily")
    public ReportService.DailyReport daily(@RequestParam(defaultValue = "7") int days) {
        return reports.daily(days);
    }

    @GetMapping("/api/reports/shipments.csv")
    public ResponseEntity<byte[]> exportCsv(@RequestParam(required = false) ShipmentStatus status,
                                            @RequestParam(required = false) Boolean active,
                                            @RequestParam(required = false) Long originId,
                                            @RequestParam(required = false) Long destinationId,
                                            @RequestParam(required = false) Direction direction,
                                            @RequestParam(required = false) Priority priority,
                                            @RequestParam(required = false) Boolean late,
                                            @RequestParam(required = false) String q,
                                            @RequestParam(required = false) Long merchantId) {
        byte[] body = reports.exportCsv(
                new ShipmentFilter(status, active, originId, destinationId, direction, priority, late, q, merchantId));
        String filename = "shipments-" + FILE_TS.format(clock.instant().atZone(clock.getZone())) + ".csv";
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(filename).build().toString())
                .body(body);
    }
}
