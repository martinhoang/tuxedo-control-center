#!/bin/bash

GREEN="\e[32m"
YELLOW="\e[33m"
RED="\e[31m"
RESET="\e[0m"

echo "=== CPU Power Limits ==="
echo "RAPL Constraint 0 (short term):"
cat /sys/class/powercap/intel-rapl/intel-rapl:0/constraint_0_power_limit_uw 2>/dev/null | awk '{printf "%.2f W\n", $1/1000000}'
echo "RAPL Constraint 1 (long term):"
cat /sys/class/powercap/intel-rapl/intel-rapl:0/constraint_1_power_limit_uw 2>/dev/null | awk '{printf "%.2f W\n", $1/1000000}'

echo -e "\n=== Current Power Draw ==="
short_limit=$(cat /sys/class/powercap/intel-rapl/intel-rapl:0/constraint_0_power_limit_uw)
echo "Short-term limit: $(bc -l <<< "$short_limit/1000000") W"

echo -e "\n=== CPU Frequencies ==="
for cpu in /sys/devices/system/cpu/cpu[0-9]*; do
    cpu_num=$(basename $cpu | tr -dc '0-9')
    cur_freq=$(cat $cpu/cpufreq/scaling_cur_freq 2>/dev/null)
    max_freq=$(cat $cpu/cpufreq/scaling_max_freq 2>/dev/null)
    governor_file="$cpu/cpufreq/scaling_governor"
    if [ -f "$governor_file" ]; then
        governor=$(cat "$governor_file")
        case "$governor" in
            "powersave")
                gov_color=$GREEN
                ;;
            "performance")
                gov_color=$RED
                ;;
            *)
                gov_color=$YELLOW
                ;;
        esac
    fi
    if [ ! -z "$cur_freq" ]; then
        echo "CPU $cpu_num:"
        echo "  Current: $(echo "scale=2; $cur_freq/1000" | bc) MHz"
        echo "  Max: $(echo "scale=2; $max_freq/1000" | bc) MHz"
        echo -e "  Governor: ${gov_color}$governor${RESET}"
    fi
done

echo -e "\n=== Intel P-State Settings ==="
if [ -f /sys/devices/system/cpu/intel_pstate/no_turbo ]; then
    echo "Turbo Boost: $([[ $(cat /sys/devices/system/cpu/intel_pstate/no_turbo) == 0 ]] && echo "Enabled" || echo "Disabled")"
fi
echo -e "\n=== CPU Performance Data ==="
echo "CPU Usage:" 
mpstat 1 1 | awk '/Average/{printf "%.2f%%\n", 100 - $NF}'
echo "CPU Temperature:" 
for temp in /sys/class/thermal/thermal_zone*/temp; do
    echo "$(basename $temp): $(cat $temp | awk '{printf "%.1f°C\n", $1/1000}')"
done
echo "Current CPU Frequency:" 
cat /proc/cpuinfo | grep 'MHz' | awk '{printf "CPU %d: %.2f MHz\n", NR, $4}'
echo "Load Average:" 
cat /proc/loadavg | awk '{printf "1 min: %.2f, 5 min: %.2f, 15 min: %.2f\n", $1, $2, $3}'
