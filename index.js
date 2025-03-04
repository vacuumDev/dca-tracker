require('dotenv').config();

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const BN = require('bn.js');
const redis = require('redis');
const { AnchorProvider, Wallet, Program, BorshInstructionCoder } = require("@project-serum/anchor");

const RPC_ENDPOINT = process.env.RPC_ENDPOINT;
const connection = new Connection(RPC_ENDPOINT, "confirmed");

const TARGET_PROGRAM_ID_STR = process.env.TARGET_PROGRAM_ID_STR;
const targetProgramId = new PublicKey(TARGET_PROGRAM_ID_STR);
const address = targetProgramId;

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TG_CHAT_ID;

const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err));

async function initRedis() {
    await redisClient.connect();
}

async function sendTelegramLog(message) {
    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const params = {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown"
    };
    try {
        const response = await fetch(telegramUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
        });
        const data = await response.json();
        if (!data.ok) {
            console.error("Error sending Telegram log:", data);
        }
    } catch (error) {
        console.error("Error sending Telegram log:", error);
    }
}


// Solscan API endpoint for token meta data
const SOLSCAN_API_URL = "https://pro-api.solscan.io/v2.0/token/meta?address=";

// Recognized stablecoins (including WSOL)
const STABLECOINS = [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
    "So11111111111111111111111111111111111111112"   // WSOL
];

// --- Helper: Recursively decode BN.js values ---
function decodeBnValues(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (obj instanceof BN) {
        return obj.toString(10);
    }
    if (Array.isArray(obj)) {
        return obj.map(decodeBnValues);
    }
    return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [key, decodeBnValues(value)])
    );
}

// --- Helper: Format dollar amounts (using "K" notation if >= 1,000) ---
function formatDollar(amount) {
    if (amount >= 1000) {
        return (amount / 1000).toFixed(2) + "K";
    }
    return amount.toFixed(2);
}

// --- Helper: Format ETA given seconds (e.g., "2h" or "2h, 40m") ---
function formatETA(seconds) {
    const days = Math.floor(seconds / 86400);
    const remainderAfterDays = seconds % 86400;
    const hours = Math.floor(remainderAfterDays / 3600);
    const remainderAfterHours = remainderAfterDays % 3600;
    const minutes = Math.floor(remainderAfterHours / 60);
    const secs = remainderAfterHours % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (parts.length === 0 && secs > 0) parts.push(`${secs}s`);
    return parts.join(" ");
}

// --- Helper: Fetch token meta data (including extra fields) ---
async function getTokenMeta(mint) {
    // Default meta object with basic placeholder values.
    let meta = {
        symbol: mint,
        price: 0,
        marketCap: "",
        volume24h: "",
        contractAddress: mint,
        decimals: 6
    };
    const url = SOLSCAN_API_URL + mint;
    try {
        const response = await fetch(url, {
            headers: {
                'token': process.env.SOLSCAN_TOKEN
            }
        });
        const data = await response.json();
        if (data.success && data.data) {
            meta.symbol = data.data.symbol || meta.symbol;
            meta.price = data.data.price || meta.price;
            // Format market cap and volume in millions with a "$" sign if available.
            if (data.data.market_cap) {
                meta.marketCap = "$" + (data.data.market_cap / 1e6).toFixed(2) + "M";
            }
            if (data.data.volume_24h) {
                meta.volume24h = "$" + (data.data.volume_24h / 1e6).toFixed(2) + "M";
            }
            meta.contractAddress = data.data.address || mint;
            meta.decimals = data.data.decimals;
        } else {
            console.warn(`No meta data found for token ${mint}. Using placeholder values.`);
        }
    } catch (err) {
        console.error(`Error fetching meta for token ${mint}:`, err);
        console.warn(`Using placeholder values for token ${mint}`);
    }
    return meta;
}

/**
 * Build and return a formatted swap log message.
 *
 * @param {Object} swapData - Decoded swap data with fields:
 *   inAmount, inAmountPerCycle, cycleFrequency (all as strings).
 * @param {Object} depositTokenMeta - Contains { decimals, price, symbol } for the deposit token.
 * @param {Object} targetTokenMeta - Contains { decimals, price, symbol } and extra fields for the target token.
 * @param {string} tradeType - "sell" or "buy".
 * @param {Object} [extraData] - Optional extra data with fields:
 *   marketCap, volume24h, price, contractAddress, user, periodStart, periodEnd.
 */
function buildSwapLog(swapData, depositTokenMeta, targetTokenMeta, tradeType, extraData = {}) {
    const totalRaw = Number(swapData.inAmount);
    const cycleRaw = Number(swapData.inAmountPerCycle);
    const frequencySec = Number(swapData.cycleFrequency);

    // Convert raw amounts using deposit token decimals
    const totalTokens = totalRaw / (10 ** depositTokenMeta.decimals);
    const cycleTokens = cycleRaw / (10 ** depositTokenMeta.decimals);

    const totalValue = totalTokens * depositTokenMeta.price;
    const frequencyValue = cycleTokens * depositTokenMeta.price;

    const numberOfCycles = Math.floor(totalRaw / cycleRaw);
    const etaSeconds = numberOfCycles * frequencySec;
    const etaStr = formatETA(etaSeconds);

    const formattedTotal = formatDollar(totalValue);
    const formattedFreq = formatDollar(frequencyValue);

    const icon = tradeType === "sell" ? "🟥" : "🟩";
    // For a "sell" order, display the deposit token's symbol; for a "buy" order, display the target token's symbol.
    const tokenSymbol = tradeType === "sell" ? depositTokenMeta.symbol : targetTokenMeta.symbol;

    const header = `$${formattedTotal} ${tradeType}ing ${tokenSymbol} ${icon}`;
    const frequencyLine = `Frequency: $${formattedFreq} every ${formatETA(frequencySec)} (${numberOfCycles} cycles)`;
    const etaLine = `ETA: ${etaStr}`;


    const periodStartDate = new Date();
    const periodEndDate = new Date(periodStartDate.getTime() + etaSeconds * 1000);

    const periodStart = periodStartDate.toUTCString();
    const periodEnd = periodEndDate.toUTCString();

    // Build extra lines if extraData is provided.
    const extraLines = [];
    extraLines.push(`MC: ${tradeType === "sell" ? depositTokenMeta.marketCap : targetTokenMeta.marketCap}`);
    if(tradeType === "sell" ? depositTokenMeta.volume24h : targetTokenMeta.volume24h) extraLines.push(`V24h: ${tradeType === "sell" ? depositTokenMeta.volume24h : targetTokenMeta.volume24h}`);
    extraLines.push(`Price: ${tradeType === "sell" ? depositTokenMeta.price.toFixed(4) : targetTokenMeta.price.toFixed(4)}`);
    extraLines.push(`CA: ${tradeType === "sell" ? depositTokenMeta.contractAddress : targetTokenMeta.contractAddress}`);
    extraLines.push(`\nUser: ${extraData.user}`);
    extraLines.push(`TX: ${extraData.signature}`);
    extraLines.push(`\nPeriod: ${periodStart} - ${periodEnd}`);

    return `${header}\n\n${frequencyLine}\n${etaLine}\n\n${extraLines.join("\n")}`;
}

// --- Main Function ---
async function main() {
    try {
        await initRedis();
        const wallet = new Wallet(Keypair.generate());
        const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

        // Fetch the IDL for the target program.
        const idl = await Program.fetchIdl(targetProgramId, provider);
        if (!idl) {
            console.error("No IDL found for the target program. It may not have been published on-chain.");
            return;
        }

        const coder = new BorshInstructionCoder(idl);
        while (true) {
            const signatures = await connection.getSignaturesForAddress(address, { limit: 1000 });
            for (const sigInfo of signatures) {
                const exists = await redisClient.exists(sigInfo.signature);
                if (exists) {
                    continue;
                }
                await redisClient.set(sigInfo.signature, "1");


                const tx = await connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
                if (!tx || !tx.meta || !tx.meta.logMessages) continue;

                const hasTargetLog = tx.meta.logMessages.some(log => log.includes("Program log: Instruction: OpenDcaV2"));
                if (!hasTargetLog) continue;

                // --- Extract Swap Data from Message Instructions ---
                let swapData = null;
                if (tx.transaction.message) {
                    for (const instruction of tx.transaction.message.instructions) {
                        if (instruction.programId.toBase58() === TARGET_PROGRAM_ID_STR && instruction.data) {
                            const decoded = coder.decode(instruction.data, "base58");
                            swapData = decodeBnValues(decoded.data);
                            console.log(`Decoded swap instruction data for tx ${sigInfo.signature}:`, swapData);
                            break; // assume one swap instruction per tx
                        }
                    }
                }
                if (!swapData) {
                    console.warn("Swap data not found in transaction", sigInfo.signature);
                    continue;
                }

                // --- Group User's Token Balances by Owner ---
                if (!tx.meta.postTokenBalances || tx.meta.postTokenBalances.length < 2) {
                    console.warn("Not enough token balance entries in transaction", sigInfo.signature);
                    continue;
                }
                const tokensByOwner = {};
                for (const entry of tx.meta.postTokenBalances) {
                    const owner = entry.owner;
                    if (!tokensByOwner[owner]) tokensByOwner[owner] = [];
                    tokensByOwner[owner].push(entry);
                }
                let userTokenEntries = null;
                for (const owner in tokensByOwner) {
                    if (tokensByOwner[owner].length >= 2) {
                        userTokenEntries = tokensByOwner[owner];
                        break;
                    }
                }
                if (!userTokenEntries) {
                    console.warn("Could not determine user token pair from token balances in tx", sigInfo.signature);
                    continue;
                }

                // --- Determine Deposit and Target Accounts & Trade Type ---
                // Assume userTokenEntries contains exactly two token accounts.
                const tokenA = userTokenEntries[0];
                const tokenB = userTokenEntries[1];
                const balanceA = tokenA.uiTokenAmount.uiAmount || 0;
                const balanceB = tokenB.uiTokenAmount.uiAmount || 0;

                // Fetch metadata and decimals for each token.
                const metaA = await getTokenMeta(tokenA.mint);
                const metaB = await getTokenMeta(tokenB.mint);

                const stableA = STABLECOINS.includes(tokenA.mint);
                const stableB = STABLECOINS.includes(tokenB.mint);

                let tradeType = "";
                let depositTokenMeta = null;
                let targetTokenMeta = null;
                if (stableA !== stableB) {
                    // Exactly one token is stable.
                    if (stableA) {
                        if (balanceA > 0) {
                            // User holds stablecoin => spending stablecoin to buy non-stable token.
                            tradeType = "buy";
                            depositTokenMeta = metaA;
                            targetTokenMeta = metaB;
                        } else {
                            tradeType = "sell";
                            depositTokenMeta = metaB;
                            targetTokenMeta = metaA;
                        }
                    } else {
                        if (balanceB > 0) {
                            tradeType = "buy";
                            depositTokenMeta = metaB;
                            targetTokenMeta = metaA;
                        } else {
                            tradeType = "sell";
                            depositTokenMeta = metaA;
                            targetTokenMeta = metaB;
                        }
                    }
                } else {
                    continue;
                }

                // --- Build Extra Data ---
                // For demonstration, we use extra fields from the target token's metadata.
                // You can replace the user and period fields with dynamic values as needed.
                const extraData = {
                    marketCap: targetTokenMeta.marketCap,
                    volume24h: targetTokenMeta.volume24h,
                    price: "$" + Number(targetTokenMeta.price).toFixed(5),
                    contractAddress: targetTokenMeta.contractAddress,
                    user: tx.transaction.message.accountKeys[0].pubkey,
                    signature: sigInfo.signature // or derive from another source if available
                };

                // --- Build and Log Swap Message ---
                const logMessage = buildSwapLog(swapData, depositTokenMeta, targetTokenMeta, tradeType, extraData);
                console.log(sigInfo.signature);
                console.log(logMessage);

                await sendTelegramLog(logMessage);
            }
        }
    } catch (err) {
        console.error("Error processing transactions:", err);
    }
}

main();
