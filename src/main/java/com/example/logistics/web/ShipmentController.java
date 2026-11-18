package com.example.logistics.web;

import com.example.logistics.common.PageView;
import com.example.logistics.geo.Direction;
import com.example.logistics.shipment.CreateShipmentRequest;
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
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/shipments")
@Validated
public class ShipmentController {
    private final ShipmentService shipments;

    public ShipmentController(ShipmentService shipments) {
        this.shipments = shipments;
    }

    public record ReasonRequest(@Size(max = 100, message = "Reason must be at most 100 characters") String reason) {
    }

    @GetMapping
    public PageView<ShipmentView> search(@RequestParam(required = false) ShipmentStatus status,
                                         @RequestParam(required = false) Boolean active,
                                         @RequestParam(required = false) Long originId,
                                         @RequestParam(required = false) Long destinationId,
                                         @RequestParam(required = false) Direction direction,
                                         @RequestParam(required = false) Priority priority,
                                         @RequestParam(required = false) Boolean late,
                                         @RequestParam(required = false) @Size(max = 40) String q,
                                         @RequestParam(required = false) Long merchantId,
                                         @RequestParam(defaultValue = "0") int page,
                                         @RequestParam(defaultValue = "20") int size) {
        return shipments.search(new ShipmentFilter(status, active, originId, destinationId, direction, priority, late, q,
                        merchantId),
                page, size);
    }

    @GetMapping("/{trackingNo}")
    public ShipmentDetail detail(@PathVariable @Size(min = 6, max = 20) String trackingNo) {
        return shipments.detail(trackingNo);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ShipmentView create(@Valid @RequestBody CreateShipmentRequest request) {
        return shipments.create(request);
    }

    @PostMapping("/quote")
    public QuoteView quote(@Valid @RequestBody QuoteRequest request) {
        return shipments.quote(request);
    }

    @PostMapping("/{id}/cancel")
    public ShipmentView cancel(@PathVariable long id, @Valid @RequestBody(required = false) ReasonRequest body) {
        return shipments.cancel(id, body == null ? null : body.reason());
    }

    @PostMapping("/{id}/exception")
    public ShipmentView exception(@PathVariable long id, @Valid @RequestBody ReasonRequest body) {
        return shipments.markException(id, body.reason());
    }

    @PostMapping("/{id}/resolve")
    public ShipmentView resolve(@PathVariable long id, @Valid @RequestBody(required = false) ReasonRequest body) {
        return shipments.resolve(id, body == null ? null : body.reason());
    }

    @PostMapping("/{id}/deliver")
    public ShipmentView deliver(@PathVariable long id) {
        return shipments.confirmDelivery(id);
    }
}
