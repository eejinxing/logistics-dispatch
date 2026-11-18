package com.example.logistics.web;

import com.example.logistics.TestData;
import com.example.logistics.hub.Hub;
import com.example.logistics.merchant.Merchant;
import com.example.logistics.merchant.MerchantRepository;
import com.example.logistics.simulation.SimulationClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {"app.seed.enabled=false", "app.simulation.enabled=false"})
@AutoConfigureMockMvc
@Import(TestData.class)
class ApiTest {
    @Autowired
    MockMvc mvc;
    @Autowired
    TestData data;
    @Autowired
    MerchantRepository merchants;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PasswordEncoder encoder;
    @Autowired
    SimulationClock clock;

    Hub kl;
    Hub penang;

    @BeforeEach
    void setUp() {
        data.reset();
        kl = data.kualaLumpur();
        penang = data.penang();
    }

    private String shipmentJson(double weightKg) {
        return """
                {"originId":%d,"destinationId":%d,"senderName":"Maju Trading","receiverName":"Tan Mei Ling",
                 "weightKg":%s,"priority":"EXPRESS"}""".formatted(kl.getId(), penang.getId(), weightKg);
    }

    @Test
    void apiCallsWithoutLoginGet401AndPagesRedirectToLogin() throws Exception {
        mvc.perform(get("/api/hubs")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/live")).andExpect(status().isUnauthorized());
        mvc.perform(get("/")).andExpect(status().is3xxRedirection()).andExpect(redirectedUrl("/login.html"));
        mvc.perform(get("/login.html")).andExpect(status().isOk());
    }

    @Test
    void configuredAdminCanLogInAndWrongPasswordCannot() throws Exception {
        mvc.perform(post("/api/auth/login").with(csrf()).param("username", "admin").param("password", "admin123"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.home").value("/"));
        mvc.perform(post("/api/auth/login").with(csrf()).param("username", "admin").param("password", "nope"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @Transactional
    void existingNonAdministratorAccountsCannotSignIn() throws Exception {
        for (String role : new String[]{"MERCHANT", "CUSTOMER"}) {
            jdbc.update("""
                    insert into app_users (username, password_hash, role, display_name, enabled, created_at, version)
                    values (?, ?, ?, ?, true, current_timestamp, 0)""",
                    role, encoder.encode("legacy-password"), role, role);
            mvc.perform(post("/api/auth/login").with(csrf()).param("username", role).param("password", "legacy-password"))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void removedPagesAndEndpointsAreAbsent() throws Exception {
        for (String path : new String[]{"/merchant.html", "/customer.html", "/register.html",
                "/api/merchant/shipments", "/api/customer/parcels", "/api/public/track/MY123456", "/api/accounts"}) {
            mvc.perform(get(path)).andExpect(status().isNotFound());
        }
        mvc.perform(post("/api/auth/register").with(csrf())).andExpect(status().isNotFound());
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void administratorsCanSelectAMerchantWhenBooking() throws Exception {
        Merchant merchant = merchants.save(new Merchant("M9001", "Maju Trading", null, null, kl, Instant.now()));
        mvc.perform(get("/api/merchants")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("Maju Trading"));
        String body = """
                {"originId":%d,"destinationId":%d,"merchantId":%d,"receiverName":"Tan Mei Ling","weightKg":20}
                """.formatted(kl.getId(), penang.getId(), merchant.getId());
        mvc.perform(post("/api/shipments").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.merchantId").value(merchant.getId()))
                .andExpect(jsonPath("$.senderName").value("Maju Trading"));
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void writesWithoutCsrfTokenAreRejected() throws Exception {
        mvc.perform(post("/api/shipments").contentType(MediaType.APPLICATION_JSON).content(shipmentJson(20)))
                .andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void createsAShipmentWithDirectionPriceAndPromise() throws Exception {
        mvc.perform(post("/api/shipments").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(shipmentJson(20)))
                .andExpect(status().isCreated())
                .andExpect(header().exists(RequestIdFilter.HEADER))
                .andExpect(jsonPath("$.trackingNo").value(containsString("MY")))
                .andExpect(jsonPath("$.status").value("CREATED"))
                .andExpect(jsonPath("$.direction").value("NW"))
                .andExpect(jsonPath("$.directionLabel").value("Northwest"))
                .andExpect(jsonPath("$.price").isNumber());
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void invalidShipmentGetsAReadableMessage() throws Exception {
        mvc.perform(post("/api/shipments").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(shipmentJson(0)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(containsString("Weight")));
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void shipmentStatusListsAndDateRangesApplyToSearchAndExport() throws Exception {
        mvc.perform(post("/api/shipments").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(shipmentJson(20)))
                .andExpect(status().isCreated());
        LocalDate today = LocalDate.now(clock);
        mvc.perform(get("/api/shipments").param("statuses", "CREATED,AT_TRANSFER")
                        .param("from", today.toString()).param("to", today.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)));
        mvc.perform(get("/api/shipments").param("status", "DELIVERED"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/shipments").param("to", today.minusDays(1).toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items", hasSize(0)));
        mvc.perform(get("/api/reports/shipments.csv").param("statuses", "CREATED,AT_TRANSFER")
                        .param("from", today.toString()).param("to", today.toString()))
                .andExpect(status().isOk()).andExpect(content().string(containsString("Maju Trading")));
        mvc.perform(get("/api/reports/shipments.csv").param("statuses", "DELIVERED,CANCELLED"))
                .andExpect(status().isOk()).andExpect(content().string(not(containsString("Maju Trading"))));
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void dashboardAggregatesInParallelAndReturnsAllEightDirections() throws Exception {
        mvc.perform(post("/api/shipments").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(shipmentJson(20)))
                .andExpect(status().isCreated());
        MvcResult started = mvc.perform(get("/api/dashboard")).andExpect(request().asyncStarted()).andReturn();
        mvc.perform(asyncDispatch(started))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.directions", hasSize(8)))
                .andExpect(jsonPath("$.degraded", hasSize(0)))
                .andExpect(jsonPath("$.alerts.exceptionTrend", hasSize(24)))
                .andExpect(jsonPath("$.alerts.exceptionTrend[23].count").value(0))
                .andExpect(jsonPath("$.lanes[0].direction").value("NW"));
    }
}
