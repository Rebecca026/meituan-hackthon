package com.meituan.route.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "session_snapshots")
public class SnapshotEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false, length = 50)
    private String sessionId;

    @Column(nullable = false)
    private Integer version;

    @Column(name = "route_json", columnDefinition = "TEXT", nullable = false)
    private String routeJson;

    @Column(name = "intent_json", columnDefinition = "TEXT")
    private String intentJson;

    @Column(name = "query_text", columnDefinition = "TEXT")
    private String queryText;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public SnapshotEntity() {}

    public SnapshotEntity(String sessionId, Integer version, String routeJson, String intentJson) {
        this(sessionId, version, routeJson, intentJson, null);
    }

    public SnapshotEntity(String sessionId, Integer version, String routeJson, String intentJson, String queryText) {
        this.sessionId = sessionId;
        this.version = version;
        this.routeJson = routeJson;
        this.intentJson = intentJson;
        this.queryText = queryText;
        this.createdAt = Instant.now();
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getSessionId() { return sessionId; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public Integer getVersion() { return version; }
    public void setVersion(Integer version) { this.version = version; }
    public String getRouteJson() { return routeJson; }
    public void setRouteJson(String routeJson) { this.routeJson = routeJson; }
    public String getIntentJson() { return intentJson; }
    public void setIntentJson(String intentJson) { this.intentJson = intentJson; }
    public String getQueryText() { return queryText; }
    public void setQueryText(String queryText) { this.queryText = queryText; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
