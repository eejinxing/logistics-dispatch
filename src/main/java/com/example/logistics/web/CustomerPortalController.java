package com.example.logistics.web;

import com.example.logistics.account.AppUserPrincipal;
import com.example.logistics.tracking.ParcelView;
import com.example.logistics.tracking.TrackingService;
import com.example.logistics.tracking.TrackingView;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/customer")
public class CustomerPortalController {
    private final TrackingService tracking;

    public CustomerPortalController(TrackingService tracking) {
        this.tracking = tracking;
    }

    @GetMapping("/parcels")
    public List<ParcelView> parcels(@AuthenticationPrincipal AppUserPrincipal me) {
        return tracking.parcelsFor(me.requirePhoneKey());
    }

    @GetMapping("/parcels/{trackingNo}")
    public TrackingView parcel(@AuthenticationPrincipal AppUserPrincipal me, @PathVariable String trackingNo) {
        return tracking.forCustomer(me.requirePhoneKey(), trackingNo);
    }
}
