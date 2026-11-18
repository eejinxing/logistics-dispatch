package com.example.logistics.web;

import com.example.logistics.account.AppUserPrincipal;
import com.example.logistics.common.PageView;
import com.example.logistics.geo.Direction;
import com.example.logistics.merchant.MerchantDashboard;
import com.example.logistics.merchant.MerchantService;
import com.example.logistics.merchant.MerchantView;
import com.example.logistics.report.ReportService;
import com.example.logistics.shipment.MerchantShipmentRequest;
import com.example.logistics.shipment.Priority;
import com.example.logistics.shipment.QuoteRequest;
import com.example.logistics.shipment.QuoteView;
import com.example.logistics.shipment.ShipmentDetail;
import com.example.logistics.shipment.ShipmentFilter;
import com.example.logistics.shipment.ShipmentService;
import com.example.logistics.shipment.ShipmentStatus;
import com.example.logistics.shipment.ShipmentView;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/api/merchant")
@Validated
public class MerchantPortalController {
    private final MerchantService merchants;
    private final ShipmentService shipments;
    private final ReportService reports;

    public MerchantPortalController(MerchantService merchants, ShipmentService shipments, ReportService reports) {
        this.merchants = merchants;
        this.shipments = shipments;
        this.reports = reports;
    }

    @GetMapping("/profile")
    public MerchantView profile(@AuthenticationPrincipal AppUserPrincipal me) {
        return merchants.profile(me.requireMerchantId());
    }

    @GetMapping("/dashboard")
    public MerchantDashboard dashboard(@AuthenticationPrincipal AppUserPrincipal me) {
        return merchants.dashboard(me.requireMerchantId());
    }

    @GetMapping("/shipments")
    public PageView<ShipmentView> shipments(@AuthenticationPrincipal AppUserPrincipal me,
                                            @RequestParam(required = false) ShipmentStatus status,
                                            @RequestParam(required = false) Boolean active,
                                            @RequestParam(required = false) Long destinationId,
                                            @RequestParam(required = false) Direction direction,
                                            @RequestParam(required = false) Priority priority,
                                            @RequestParam(required = false) Boolean late,
                                            @RequestParam(required = false) @Size(max = 40) String q,
                                            @RequestParam(defaultValue = "0") int page,
                                            @RequestParam(defaultValue = "20") int size) {
        ShipmentFilter filter = new ShipmentFilter(status, active, null, destinationId, direction, priority, late, q, null);
        return shipments.search(filter.forMerchant(me.requireMerchantId()), page, size);
    }

    @GetMapping("/shipments/{trackingNo}")
    public ShipmentDetail detail(@AuthenticationPrincipal AppUserPrincipal me, @PathVariable String trackingNo) {
        return shipments.detailForMerchant(me.requireMerchantId(), trackingNo);
    }

    @PostMapping("/shipments")
    @ResponseStatus(HttpStatus.CREATED)
    public ShipmentView create(@AuthenticationPrincipal AppUserPrincipal me,
                               @Valid @RequestBody MerchantShipmentRequest request) {
        return shipments.createForMerchant(me.requireMerchantId(), request);
    }

    @PostMapping("/shipments/quote")
    public QuoteView quote(@Valid @RequestBody QuoteRequest request) {
        return shipments.quote(request);
    }

    @PostMapping("/shipments/{id}/cancel")
    public ShipmentView cancel(@AuthenticationPrincipal AppUserPrincipal me, @PathVariable long id,
                               @Valid @RequestBody(required = false) ShipmentController.ReasonRequest body) {
        return shipments.cancelForMerchant(me.requireMerchantId(), id, body == null ? null : body.reason());
    }

    @GetMapping("/shipments.csv")
    public ResponseEntity<byte[]> export(@AuthenticationPrincipal AppUserPrincipal me) {
        byte[] body = reports.exportCsv(new ShipmentFilter(null, null, null, null, null, null, null, null,
                me.requireMerchantId()));
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename("my-shipments.csv").build().toString())
                .body(body);
    }
}
