use axum::http::{header, Method};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod auth;
mod config;
mod database;
mod errors;
mod jobs;
mod media;
mod models;
mod security;
mod storage;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ownmediahost_backend=debug,tower_http=debug,axum=trace".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting OwnMediaHost personal media platform backend...");

    // Load configuration
    let config = config::AppConfig::from_env();
    info!("Configuration loaded. Environment: {}", config.app_env);

    // Initialize Database
    let pool = database::init_db(&config).await?;

    // Initialize Storage
    let storage = storage::LocalStorageProvider::new(config.media_root.clone())?;

    let config_arc = Arc::new(config);

    // Start background job worker
    jobs::spawn_job_worker(pool.clone(), storage.clone(), config_arc.clone());

    // Configure CORS
    let cors = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::RANGE,
            header::HeaderName::from_static("x-request-id"),
        ])
        .allow_credentials(true)
        .allow_origin(
            config_arc
                .allowed_origins
                .iter()
                .filter_map(|o| o.parse().ok())
                .collect::<Vec<_>>(),
        );

    // Build Axum router
    let app = api::create_router(pool.clone(), storage.clone(), config_arc.clone())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(axum::Extension(pool))
        .layer(axum::Extension(config_arc.clone()));

    let bind_addr = format!("{}:{}", config_arc.host, config_arc.port);
    info!("OwnMediaHost server listening on http://{}", bind_addr);
    info!("API documentation available at http://{}/docs", bind_addr);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("OwnMediaHost server gracefully stopped.");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

