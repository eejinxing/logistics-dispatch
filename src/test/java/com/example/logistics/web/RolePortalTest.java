package com.example.logistics.web;

import com.example.logistics.TestData;
import com.example.logistics.account.AppUser;
import com.example.logistics.account.AppUserPrincipal;
import com.example.logistics.account.AppUserRepository;
import com.example.logistics.account.Role;
import com.example.logistics.hub.Hub;
import com.example.logistics.merchant.Merchant;
import com.example.logistics.merchant.MerchantRepository;
import com.example.logistics.shipment.MerchantShipmentRequest;
import com.example.logistics.shipment.Priority;
import com.example.logistics.shipment.ShipmentService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {"app.seed.enabled=false", "app.simulation.enabled=false"})
@AutoConfigureMockMvc
@Import(TestData.class)
class RolePortalTest {
    private static final String CUSTOMER_PHONE = "012-111 2222";

    @Autowired
    MockMvc mvc;
    @Autowired
    TestData data;
    @Autowired
    MerchantRepository merchants;
    @Autowired
    AppUserRepository users;
    @Autowired
    ShipmentService shipments;
    @Autowired
    PasswordEncoder encoder;

    Hub kl;
    Hub penang;
    AppUserPrincipal shopA;
    AppUserPrincipal customer;
    String parcelForCustomer;
    String parcelOfShopB;

    @BeforeEach
    void setUp() {
        data.reset();
        kl = data.kualaLumpur();
        penang = data.penang();
        Instant now = Instant.now();
        Merchant a = merchants.save(new Merchant("M9001", "Shop A", "Ali", "011-000 0001", kl, now));
        Merchant b = merchants.save(new Merchant("M9002", "Shop B", "Bala", "011-000 0002", penang, now));

        parcelForCustomer = shipments.createForMerchant(a.getId(), new MerchantShipmentRequest(null, penang.getId(),
                "Lim Wei", CUSTOMER_PHONE, "No. 1 Jalan Satu", 12.0, Priority.STANDARD)).trackingNo();
        parcelOfShopB = shipments.createForMerchant(b.getId(), new MerchantShipmentRequest(null, kl.getId(),
                "Someone Else", "019-999 8888", null, 5.0, Priority.EXPRESS)).trackingNo();

        AppUser shopUser = users.save(new AppUser("shop-a", encoder.encode("secret1"), Role.MERCHANT, "Ali", a, null, now));
        AppUser customerUser = users.save(new AppUser("lim", encoder.encode("secret2"), Role.CUSTOMER, "Lim Wei", null,
                "+60 12 111 2222", now));
        shopA = AppUserPrincipal.from(shopUser);
        customer = AppUserPrincipal.from(customerUser);
    }

    @Test
    void merchantsCannotOpenTheAdminConsole() throws Exception {
        mvc.perform(get("/api/hubs").with(user(shopA))).andExpect(status().isForbidden());
        mvc.perform(get("/").with(user(shopA))).andExpect(redirectedUrl("/merchant.html"));
        mvc.perform(get("/api/customer/parcels").with(user(shopA))).andExpect(status().isForbidden());
    }

    @Test
    void merchantSeesOnlyItsOwnShipments() throws Exception {
        mvc.perform(get("/api/merchant/shipments").with(user(shopA)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].trackingNo").value(parcelForCustomer));
        mvc.perform(get("/api/merchant/shipments/" + parcelOfShopB).with(user(shopA)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/merchant/dashboard").with(user(shopA)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.merchant.name").value("Shop A"))
                .andExpect(jsonPath("$.directions", hasSize(8)));
    }

    @Test
    void merchantBookingsUseTheirNameAndHomeHub() throws Exception {
        String body = """
                {"destinationId":%d,"receiverName":"Ahmad","receiverPhone":"013-222 3333","weightKg":3}"""
                .formatted(penang.getId());
        mvc.perform(post("/api/merchant/shipments").with(user(shopA)).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.senderName").value("Shop A"))
                .andExpect(jsonPath("$.merchantName").value("Shop A"))
                .andExpect(jsonPath("$.origin.code").value("KUL"));
    }

    @Test
    void customerSeesParcelsSentToTheirPhone() throws Exception {
        mvc.perform(get("/api/customer/parcels").with(user(customer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].trackingNo").value(parcelForCustomer))
                .andExpect(jsonPath("$[0].senderName").value("Shop A"));
        mvc.perform(get("/api/customer/parcels/" + parcelForCustomer).with(user(customer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.full").value(true))
                .andExpect(jsonPath("$.receiverAddress").value("No. 1 Jalan Satu"))
                .andExpect(jsonPath("$.route[0].code").value("KUL"));
        mvc.perform(get("/api/customer/parcels/" + parcelOfShopB).with(user(customer)))
                .andExpect(status().isNotFound());
    }

    @Test
    void publicTrackingWorksWithoutLoginButHidesPersonalData() throws Exception {
        mvc.perform(get("/api/public/track/" + parcelForCustomer))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.full").value(false))
                .andExpect(jsonPath("$.statusLabel").value("Awaiting dispatch"))
                .andExpect(jsonPath("$.receiverName").value(nullValue()))
                .andExpect(jsonPath("$.merchantName").value(nullValue()))
                .andExpect(jsonPath("$.events[0].note").value(nullValue()));
    }

    @Test
    void customerSignUpNeedsAParcelSentToThatPhone() throws Exception {
        String wrong = """
                {"username":"newbie","password":"secret9","displayName":"Lim","phone":"012-111 2222","trackingNo":"%s"}"""
                .formatted(parcelOfShopB);
        mvc.perform(post("/api/auth/register").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(wrong))
                .andExpect(status().isConflict());

        String other = """
                {"username":"newbie","password":"secret9","displayName":"Someone","phone":"019-999 8888","trackingNo":"%s"}"""
                .formatted(parcelOfShopB);
        mvc.perform(post("/api/auth/register").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(other))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("CUSTOMER"));

        String again = other.replace("newbie", "newbie2");
        mvc.perform(post("/api/auth/register").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(again))
                .andExpect(status().isConflict());
    }

    @Test
    void loginSendsEachRoleToItsOwnPage() throws Exception {
        mvc.perform(post("/api/auth/login").with(csrf()).param("username", "shop-a").param("password", "secret1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.home").value("/merchant.html"));
        mvc.perform(post("/api/auth/login").with(csrf()).param("username", "lim").param("password", "secret2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.home").value("/customer.html"));
    }
}
