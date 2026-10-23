// ==UserScript==
// @name         Snowy Bot - Just-Dice Auto Runner with Watchdog
// @namespace    http://tampermonkey.net/
// @version      2.1
// @match        https://just-dice.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let state = {
        startingPocketChange: 0.0,
        tinyPeanutSize: 0.0,
        backupPeanut: 0.0,
        walletStash: 0.0,
        previousWalletState: 0.0,
        currentWagerAmount: 0.0,
        previousWagerAmount: 0.0,
        checkpointJuice: 0.0,
        wobbleFactor: 1.0,
        safetyCheckpoint: 0.0,
        lastObservedBalance: 0.0,
        lastBalanceChangeTime: Date.now(),
        hasPlacedFirstBet: false,
        watchdogThreshold: 10000, // 10 seconds
        timerId: null
    };

    const STATE_KEY = "snowy_bot_tm_state";
    const round8 = val => Number(Number(val).toFixed(8));

    function loadState() {
        try { let saved = localStorage.getItem(STATE_KEY); return saved ? JSON.parse(saved) : null; } catch(e) { return null; }
    }

    function saveState() {
        try {
            let data = {
                walletStash: round8(state.walletStash),
                startingPocketChange: round8(state.startingPocketChange),
                tinyPeanutSize: round8(state.tinyPeanutSize),
                backupPeanut: round8(state.backupPeanut),
                previousWagerAmount: round8(state.previousWagerAmount),
                checkpointJuice: round8(state.checkpointJuice),
                wobbleFactor: state.wobbleFactor,
                safetyCheckpoint: round8(state.safetyCheckpoint)
            };
            localStorage.setItem(STATE_KEY, JSON.stringify(data));
        } catch(e) {}
    }

    function calculateNextProgressionStep(incomingWager) {
        let base_wager = round8(incomingWager);
        state.walletStash = round8(state.walletStash);
        state.checkpointJuice = round8(state.checkpointJuice);
        state.safetyCheckpoint = round8(state.safetyCheckpoint);

        let threshold = round8(state.safetyCheckpoint + ((state.tinyPeanutSize * 10) * state.wobbleFactor));
        if (state.walletStash >= threshold) {
            state.currentWagerAmount = round8(state.tinyPeanutSize);
            state.wobbleFactor = 1.0;
            state.checkpointJuice = round8(Math.floor(state.walletStash / (state.tinyPeanutSize * 10)) * (state.tinyPeanutSize * 10));
            state.safetyCheckpoint = state.checkpointJuice;
            return state.currentWagerAmount;
        }

        if (base_wager > state.backupPeanut) {
            if (state.walletStash > round8(state.checkpointJuice + (base_wager * 5.0))) {
                state.currentWagerAmount = round8(base_wager * 2.0);
                state.checkpointJuice = round8(state.walletStash);
            } else if (state.walletStash < round8(state.checkpointJuice - (base_wager * 5.0))) {
                state.currentWagerAmount = round8(base_wager * 2.0);
                state.wobbleFactor = 0.0;
                state.checkpointJuice = round8(state.walletStash);
            } else {
                state.currentWagerAmount = base_wager;
            }
        } else {
            if (state.walletStash > round8(state.checkpointJuice + round8(base_wager * 7.0))) {
                state.currentWagerAmount = round8(base_wager * 2.0);
                state.checkpointJuice = round8(state.walletStash);
            } else if (state.walletStash < round8(state.checkpointJuice - round8(base_wager * 3.0))) {
                state.currentWagerAmount = round8(base_wager * 2.0);
                state.checkpointJuice = round8(state.walletStash);
            } else {
                state.currentWagerAmount = base_wager;
            }
        }
        return round8(state.currentWagerAmount);
    }

    function initBot() {
        let balElem = document.getElementById('pct_balance');
        if (!balElem) return false;

        let current_bal = round8(parseFloat(balElem.value.replace(/,/g, '').trim()));
        if (isNaN(current_bal) || current_bal <= 0) return false;

        let savedState = loadState();
        state.startingPocketChange = savedState ? savedState.startingPocketChange : current_bal;
        state.tinyPeanutSize = savedState ? savedState.tinyPeanutSize : round8(state.startingPocketChange / 1440000.0);
        state.backupPeanut = savedState ? savedState.backupPeanut : state.tinyPeanutSize;

        state.walletStash = savedState ? savedState.walletStash : current_bal;
        state.previousWalletState = savedState ? savedState.previousWalletState : state.walletStash;
        state.currentWagerAmount = savedState ? savedState.currentWagerAmount : state.backupPeanut;
        state.previousWagerAmount = savedState ? savedState.previousWagerAmount : state.currentWagerAmount;

        state.checkpointJuice = savedState ? savedState.checkpointJuice : state.walletStash;
        state.wobbleFactor = savedState ? savedState.wobbleFactor : 1.0;
        state.safetyCheckpoint = savedState ? savedState.safetyCheckpoint : state.walletStash;

        state.lastObservedBalance = current_bal;
        state.lastBalanceChangeTime = Date.now();
        state.hasPlacedFirstBet = false;

        console.log(`%c[SnowyBot] Initialized! Balance: ${state.walletStash} | TinyPeanut: ${state.tinyPeanutSize}`, "color: #38bdf8; font-weight: bold;");
        console.log("[Watchdog] 10-second stall watchdog is active and monitoring.");
        return true;
    }

    function runBot() {
        if (!initBot()) {
            setTimeout(runBot, 3000);
            return;
        }

        if (state.timerId) clearInterval(state.timerId);

        state.timerId = setInterval(() => {
            let balElem = document.getElementById('pct_balance');
            if (!balElem) return;

            state.walletStash = round8(parseFloat(balElem.value.replace(/,/g, '').trim()));
            let currentTime = Date.now();

            let balance_changed = (
                state.walletStash === round8(state.lastObservedBalance + state.previousWagerAmount) ||
                state.walletStash === round8(state.lastObservedBalance - state.previousWagerAmount)
            );

            if (state.walletStash > 0 && balance_changed) {
                state.lastBalanceChangeTime = currentTime;
                state.lastObservedBalance = state.walletStash;
            }

            let elapsed_stagnation = currentTime - state.lastBalanceChangeTime;

            // Watchdog Stall Check (10 seconds)
            if (elapsed_stagnation >= state.watchdogThreshold || state.walletStash <= 0) {
                console.warn("[Watchdog] Balance has stalled or zeroed. Reloading page...");
                location.reload();
                return;
            }

            if (balance_changed || !state.hasPlacedFirstBet) {
                state.hasPlacedFirstBet = true;
                let computedNextBet = calculateNextProgressionStep(state.previousWagerAmount);

                if (state.walletStash >= 144000) {
                    console.log(`[SnowyBot] Target reached (${state.walletStash}). Halting.`);
                    localStorage.removeItem(STATE_KEY);
                    clearInterval(state.timerId);
                    return;
                }

                console.log(`[SnowyBot] Bet: ${computedNextBet} | Balance: ${state.walletStash} | Profit: ${round8(state.walletStash - state.startingPocketChange)}`);

                let bMin = document.getElementById('b_min');
                let pChance = document.getElementById('pct_chance');
                let pBet = document.getElementById('pct_bet');
                let aLo = document.getElementById('a_lo');

                if (bMin && pBet && aLo) {
                    bMin.click();
                    if (pChance) pChance.value = '49.5';
                    pBet.value = computedNextBet.toFixed(8);
                    aLo.click();
                }

                state.previousWagerAmount = computedNextBet;
                state.previousWalletState = state.walletStash;
                saveState();
            }
        }, 300);
    }

    window.addEventListener('load', () => {
        setTimeout(runBot, 3000);
    });
})();