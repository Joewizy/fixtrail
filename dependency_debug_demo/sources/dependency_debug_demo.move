module dependency_debug_demo::dependency_debug_demo;

// Fixed after a FixTrail troubleshooting session: return a number, not bytes.
public fun retry_delay_ms(): u64 {
    1000
}

