package com.example.logistics.web;

import com.example.logistics.TestData;
import com.example.logistics.hub.Hub;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
    void dashboardAggregatesInParallelAndReturnsAllEightDirections() throws Exception {
        mvc.perform(post("/api/shipments").with(csrf()).contentType(MediaType.APPLICATION_JSON).content(shipmentJson(20)))
                .andExpect(status().isCreated());
        MvcResult started = mvc.perform(get("/api/dashboard")).andExpect(request().asyncStarted()).andReturn();
        mvc.perform(asyncDispatch(started))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.directions", hasSize(8)))
                .andExpect(jsonPath("$.degraded", hasSize(0)))
                .andExpect(jsonPath("$.lanes[0].direction").value("NW"));
    }
}
