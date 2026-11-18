package com.example.logistics.web;

import com.example.logistics.merchant.MerchantRepository;
import com.example.logistics.merchant.MerchantView;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
public class MerchantController {
    private final MerchantRepository merchants;

    public MerchantController(MerchantRepository merchants) {
        this.merchants = merchants;
    }

    @GetMapping("/api/merchants")
    public List<MerchantView> shipmentOptions() {
        return merchants.findShipmentOptions();
    }
}
