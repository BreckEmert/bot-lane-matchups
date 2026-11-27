"use strict";
// Build Calculator: a browser port of league_items/league_app.py (the Streamlit damage calculator).
// The damage engine below mirrors that file function for function; keep the two in step.
// Data comes from calculator-data.json, written by league_items/export_calculator_data.py.
(() => {
  // ---------------------------------------------------------------- config (mirrors league_app.py)
  const RESIST_VALUES = Array.from({ length: 126 }, (_, index) => 25 + index);
  const BREAKDOWN_DEFAULT_RESIST = 30;
  const ABILITY_MAX_RANKS = { Q: 5, W: 5, E: 5, R: 3 };
  const MAX_CHAMPION_LEVEL = 18;
  const PASSIVE_ABILITY = "P";
  const ATTACK_TOKEN = "A";
  const DAMAGE_TYPES = ["physical", "magic"];
  const SERIES_COLORS = ["#2a78d6", "#eb6834"];

  const ON_HIT_PASSIVES = {
    "Lucian": { ability: "P", requiresPrecedingAbility: true },
    "Akali": { ability: "P", requiresPrecedingAbility: true },
    "Orianna": { ability: "P", requiresPrecedingAbility: false },
    "Mel": { ability: "P", requiresPrecedingAbility: false },
  };
  const RANK_ALIASES = { "Mel": { S: "R", F: "E" } };

  const CHAMPION_SPECIAL_OPTIONS = {
    "Syndra": [{ kind: "scale", ability: "R", label: "Ult spheres", choices: [3, 4, 5, 6, 7], default: 5 }],
    "Karthus": [{ kind: "scale", ability: "E", label: "Seconds in E (Defile)", choices: [1, 2, 3, 4, 5], default: 3 }],
    "Amumu": [{ kind: "scale", ability: "W", label: "Seconds in W (Despair)", choices: [1, 2, 3, 4, 5], default: 3 }],
    "Fizz": [{ kind: "scale", ability: "W", label: "Seconds of W (Seastone Trident)", choices: [1, 2, 3, 4, 5], default: 3 }],
    "Mel": [
      { kind: "stacks", ability: "S", label: "Ult Overwhelm stacks", choices: [0, 5, 10, 15, 20, 25, 26, 30, 40, 50], default: 10 },
      { kind: "stacks", ability: "F", label: "Seconds in E field", choices: [0, 1, 2, 3, 4], default: 0 },
    ],
    "Kai'Sa": [{ kind: "scale", ability: "P", label: "Passive (Plasma) procs", choices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], default: 5 }],
    "Evelynn": [{
      kind: "shred", label: "W (Allure) MR shred",
      choices: { "Off": 0, "On – W1 (−35%)": 0.35, "On – W2 (−37.5%)": 0.375, "On – W3 (−40%)": 0.40, "On – W4 (−42.5%)": 0.425, "On – W5 (−45%)": 0.45 },
      default: "On – W5 (−45%)",
    }],
  };

  const ITEM_SPECIAL_OPTIONS = {
    "Lich Bane": [{ kind: "item_scale", label: "Lich Bane procs", choices: [1, 2, 3, 4, 5, 6], default: 1 }],
    "Essence Reaver": [{ kind: "item_scale", label: "Essence Reaver procs", choices: [1, 2, 3, 4, 5, 6], default: 1 }],
    "Sheen": [{ kind: "item_scale", label: "Sheen procs", choices: [1, 2, 3, 4, 5, 6], default: 1 }],
    "Mejai's Soulstealer": [{ kind: "item_stacks", label: "Mejai's stacks", apPerStack: 5, min: 0, max: 25, default: 25 }],
    "Dark Seal": [{ kind: "item_stacks", label: "Dark Seal stacks", apPerStack: 4, min: 0, max: 10, default: 10 }],
  };
  const ITEM_AP_PER_STACK = {};
  for (const [itemName, options] of Object.entries(ITEM_SPECIAL_OPTIONS)) {
    for (const option of options) if (option.kind === "item_stacks") ITEM_AP_PER_STACK[itemName] = option.apPerStack;
  }

  const BASE_AD_AT_ZERO_GOLD = 52.0;
  const BASE_AD_AT_FULL_BUILD = 115.0;
  const FULL_BUILD_GOLD = 15000.0;
  const ITEM_BASE_AD_SCALING = { "Lich Bane": 0.75, "Essence Reaver": 1.25, "Sheen": 1.00 };
  const ITEM_CRIT_SCALED_FLAT = { "Essence Reaver": 50 };
  const ITEM_EXTRA_DAMAGE_TYPE = { "Essence Reaver": "physical", "Sheen": "physical" };
  const CRIT_SCALED_SHOTS = { "Lucian": { R: 22 } };
  const SHOTS_FROM_FULL_CRIT_DAMAGE = 6;
  const BASE_CRIT_MULTIPLIER = 2.0;
  const ABILITIES_THAT_CRIT = new Set(["Lucian|P"]);
  const MID_LANE_QUEST_AP_MULT = 1.08;
  const ITEM_LEVEL_SCALED_EXTRA = { "Hextech Gunblade": [175, 253] };
  const RUNE_OPTIONS = {
    "Arcane Comet": { label: "Comet activations", damageAtLevel1: 30, damageAtLevel18: 220, apRatio: 10, choices: [0, 1, 2, 3, 4], default: 0 },
  };
  const PTA_ATTACKS_REQUIRED = 3;
  const PTA_DAMAGE_AT_LEVEL_1 = 40;
  const PTA_DAMAGE_AT_LEVEL_18 = 174.12;
  const PTA_DAMAGE_AMP = 0.08;

  const MODE_BUILDS = "builds";
  const MODE_NEXT = "next";
  // v3: build slot 1 became boots-only and builds default to each champion's level-11 build,
  // so settings saved under earlier keys are dropped.
  const STORAGE_KEY = "buildCalculator.v3";
  const DEFAULT_CHAMPION = "Syndra";

  // ---------------------------------------------------------------- engine
  let abilityRowsByChampion = {};   // champ -> [{ability, rank, base, apRatio, adRatio, bonusAdRatio, damageType}]
  let itemByName = {};              // item name -> item row
  let itemNamesByKind = { ad: [], ap: [], boots: [] };   // A-Z. Build slot 1 lists boots; the rest list AD | AP.
  const FALLBACK_BOOTS = ["Sorcerer's Shoes", "Spellslinger's Shoes"];
  const BUILD_LISTS = new Set(["buildA", "buildB", "core"]);
  const isBootsSlot = (listName, slot) => BUILD_LISTS.has(listName) && slot === 0;
  // Boots only the mid lane role quest can give, so holding them means the quest is done.
  const QUEST_UPGRADED_BOOTS = new Set(["Spellslinger's Shoes"]);

  // The quest toggle follows the boots: on when a build on screen holds upgraded boots, off otherwise.
  // Called only when boots change, so a manual click on the toggle holds until the next boots change.
  function syncQuestToBoots() {
    const lists = calcState.mode === MODE_BUILDS ? ["buildA", "buildB"] : ["core"];
    calcState.midLaneQuest = lists.some((listName) => QUEST_UPGRADED_BOOTS.has(calcState[listName][0]));
  }
  let expectedGold = null;          // expected-gold.json: typical gold earned on reaching each level

  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const estimateBaseAd = (buildCost) =>
    BASE_AD_AT_ZERO_GOLD + (BASE_AD_AT_FULL_BUILD - BASE_AD_AT_ZERO_GOLD) * clamp(buildCost / FULL_BUILD_GOLD, 0, 1);
  const interpolateByLevel = (valueAtLevel1, valueAtLevel18, championLevel) =>
    valueAtLevel1 + (valueAtLevel18 - valueAtLevel1) * ((clamp(championLevel, 1, MAX_CHAMPION_LEVEL) - 1) / 17);
  const rankFor = (ability, ranks, championLevel) =>
    ability === PASSIVE_ABILITY ? Math.max(1, championLevel) : (ranks[ability] ?? 0);
  const combinePercent = (first, second) => 1 - (1 - first) * (1 - second);
  const emptyExtras = () => Object.fromEntries(DAMAGE_TYPES.map((damageType) =>
    [damageType, { flat: 0, apRatio: 0, baseAdRatio: 0, critFlat: 0 }]));

  function getAbilityRow(champ, ability, rank) {
    return (abilityRowsByChampion[champ] || []).find((row) => row.ability === ability && row.rank === rank) || null;
  }
  const abilityDamage = (row, apTotal, totalAd, bonusAd) =>
    row.base + row.apRatio * apTotal + row.adRatio * totalAd + row.bonusAdRatio * bonusAd;

  function summarizeBuild(items, itemMultipliers = {}, itemStackCounts = {}, championLevel = MAX_CHAMPION_LEVEL, questApMult = 1) {
    if (!items.length) {
      return { ap: 0, flatPen: 0, percentPen: 0, apMult: 1, dmgMult: 1, bonusAd: 0, critChance: 0, critDamage: 0,
        flatArmorPen: 0, percentArmorPen: 0, extras: emptyExtras(), cost: 0 };
    }
    const sum = (field) => items.reduce((total, item) => total + (Number(item[field]) || 0), 0);
    let ap = sum("AP");
    // Stacking passives add real AP, so they land before apMult and Rabadon's amplifies them.
    for (const item of items) {
      const apPerStack = ITEM_AP_PER_STACK[item.Item];
      if (apPerStack) ap += apPerStack * (itemStackCounts[item.Item] || 0);
    }
    let percentFactor = 1;
    let armorFactor = 1;
    let apMult = questApMult;
    let dmgMult = 1;
    for (const item of items) {
      percentFactor *= 1 - (Number(item.PercentPen) || 0) / 100;
      armorFactor *= 1 - (Number(item.PercentArmorPen) || 0) / 100;
      apMult *= Number(item.APMult) || 1;
      dmgMult *= Number(item.DamageMult) || 1;
    }
    const extras = emptyExtras();
    for (const item of items) {
      const count = itemMultipliers[item.Item] ?? 1;
      const pool = extras[ITEM_EXTRA_DAMAGE_TYPE[item.Item] || "magic"];
      let flat = Number(item.ExtraDamage) || 0;
      const levelRange = ITEM_LEVEL_SCALED_EXTRA[item.Item];
      if (levelRange) flat = interpolateByLevel(levelRange[0], levelRange[1], championLevel);
      pool.flat += flat * count;
      pool.apRatio += (Number(item.ExtraAPScaling) || 0) / 100 * count;
      pool.baseAdRatio += (ITEM_BASE_AD_SCALING[item.Item] || 0) * count;
      pool.critFlat += (ITEM_CRIT_SCALED_FLAT[item.Item] || 0) * count;
    }
    return {
      ap, flatPen: sum("FlatPen"), percentPen: 1 - percentFactor, apMult, dmgMult,
      bonusAd: sum("AD"), critChance: Math.min(sum("CritChance"), 100) / 100, critDamage: sum("CritDamage") / 100,
      flatArmorPen: sum("FlatArmorPen"), percentArmorPen: 1 - armorFactor, extras, cost: sum("Cost"),
    };
  }

  function applyResist(damage, resist, flatPen, percentPen) {
    const effective = resist * (1 - percentPen) - flatPen;
    return damage * (effective >= 0 ? 100 / (100 + effective) : 2 - 100 / (100 - effective));
  }
  const critExpectation = (build) => 1 + build.critChance * (BASE_CRIT_MULTIPLIER - 1 + build.critDamage);

  function abilityCount(champ, ability, abilityMultipliers, build) {
    const shotsAtZeroCrit = CRIT_SCALED_SHOTS[champ]?.[ability];
    if (shotsAtZeroCrit) {
      return shotsAtZeroCrit * (1 + build.critChance) + SHOTS_FROM_FULL_CRIT_DAMAGE * Math.min(build.critDamage, 1);
    }
    return abilityMultipliers[ability] ?? 1;
  }
  const adaptiveDamageType = (build) => (build.bonusAd >= build.ap * build.apMult ? "physical" : "magic");
  const formatCount = (count) => String(Number(count.toPrecision(6)));

  // Each hit of the combo in order: [label, damageType, damage].
  function* walkCombo(champ, combo, ranks, championLevel, build, abilityMultipliers, pressTheAttack) {
    const apTotal = build.ap * build.apMult;
    const bonusAd = build.bonusAd;
    const totalAd = estimateBaseAd(build.cost) + bonusAd;
    const onHit = ON_HIT_PASSIVES[champ];
    let attacksSoFar = 0;
    let amp = 1;
    for (let position = 0; position < combo.length; position++) {
      const token = combo[position];
      if (token === ATTACK_TOKEN) {
        attacksSoFar += 1;
        yield ["Basic attack", "physical", totalAd * critExpectation(build) * amp];
        const followsAbility = position > 0 && combo[position - 1] !== ATTACK_TOKEN;
        if (onHit && (followsAbility || !onHit.requiresPrecedingAbility)) {
          const row = getAbilityRow(champ, onHit.ability, rankFor(onHit.ability, ranks, championLevel));
          if (row) {
            let hit = abilityDamage(row, apTotal, totalAd, bonusAd);
            if (ABILITIES_THAT_CRIT.has(`${champ}|${onHit.ability}`)) hit *= critExpectation(build);
            yield [`Passive (${onHit.ability})`, row.damageType, hit * amp];
          }
        }
        if (pressTheAttack && attacksSoFar === PTA_ATTACKS_REQUIRED) {
          yield ["Press the Attack", adaptiveDamageType(build),
            interpolateByLevel(PTA_DAMAGE_AT_LEVEL_1, PTA_DAMAGE_AT_LEVEL_18, championLevel)];
          amp = 1 + PTA_DAMAGE_AMP;
        }
        continue;
      }
      const rank = rankFor(token, ranks, championLevel);
      if (rank <= 0) continue;
      const row = getAbilityRow(champ, token, rank);
      if (!row) continue;
      const count = abilityCount(champ, token, abilityMultipliers, build);
      let label = `${token} (rank ${rank})`;
      if (count !== 1) label += ` ×${formatCount(count)}`;
      yield [label, row.damageType, abilityDamage(row, apTotal, totalAd, bonusAd) * count * amp];
    }
  }

  // Extra hits outside the combo (rune procs, per-stack rows): [label, damageType, damage, row-or-null, count].
  function* extraHits(champ, ranks, championLevel, build, extraHitSpecs) {
    const apTotal = build.ap * build.apMult;
    const bonusAd = build.bonusAd;
    const totalAd = estimateBaseAd(build.cost) + bonusAd;
    for (const spec of extraHitSpecs) {
      if (!spec.count) continue;
      if ("flat" in spec) {
        yield [`${spec.label} ×${formatCount(spec.count)}`, spec.damageType || "magic", (spec.flat + spec.ratio * apTotal) * spec.count, null, spec.count, spec];
        continue;
      }
      if (!spec.ability) continue;
      const rank = rankFor(spec.ability, ranks, championLevel);
      if (rank <= 0) continue;
      const row = getAbilityRow(champ, spec.ability, rank);
      if (!row) continue;
      yield [`${spec.label} ×${formatCount(spec.count)}`, row.damageType, abilityDamage(row, apTotal, totalAd, bonusAd) * spec.count, row, spec.count, spec];
    }
  }

  const itemProcTotal = (extra, build, baseAd) =>
    extra.flat + extra.apRatio * build.ap * build.apMult + extra.baseAdRatio * baseAd + extra.critFlat * build.critChance;

  function comboDamageByType(setup, build) {
    const pools = { physical: 0, magic: 0 };
    for (const [, damageType, damage] of walkCombo(setup.champ, setup.combo, setup.ranks, setup.championLevel, build, setup.abilityMultipliers, setup.pressTheAttack)) {
      pools[damageType] += damage;
    }
    for (const [, damageType, damage] of extraHits(setup.champ, setup.ranks, setup.championLevel, build, setup.extraHitSpecs)) {
      pools[damageType] += damage;
    }
    const baseAd = estimateBaseAd(build.cost);
    for (const [damageType, extra] of Object.entries(build.extras)) pools[damageType] += itemProcTotal(extra, build, baseAd);
    return pools;
  }

  function comboDamageVsResist(setup, build, resist) {
    const pools = comboDamageByType(setup, build);
    const magic = applyResist(pools.magic, resist, build.flatPen, combinePercent(build.percentPen, setup.bonusPercentPen));
    const physical = applyResist(pools.physical, resist, build.flatArmorPen, build.percentArmorPen);
    return (magic + physical) * build.dmgMult;
  }

  // Headline numbers for the chart title: flat damage plus the AP and AD ratios behind it.
  function comboBaseAndRatio(setup, build) {
    const { champ, combo, ranks, championLevel } = setup;
    const baseAd = estimateBaseAd(build.cost);
    let baseTotal = 0;
    let apRatioTotal = 0;
    let adRatioTotal = 0;
    const add = (row, count) => {
      if (!row) return;
      baseTotal += row.base * count;
      apRatioTotal += row.apRatio * count;
      adRatioTotal += (row.adRatio + row.bonusAdRatio) * count;
    };
    const onHit = ON_HIT_PASSIVES[champ];
    combo.forEach((token, position) => {
      if (token === ATTACK_TOKEN) {
        adRatioTotal += 1;
        const followsAbility = position > 0 && combo[position - 1] !== ATTACK_TOKEN;
        if (onHit && (followsAbility || !onHit.requiresPrecedingAbility)) {
          add(getAbilityRow(champ, onHit.ability, rankFor(onHit.ability, ranks, championLevel)), 1);
        }
        return;
      }
      const rank = rankFor(token, ranks, championLevel);
      if (rank <= 0) return;
      add(getAbilityRow(champ, token, rank), abilityCount(champ, token, setup.abilityMultipliers, build));
    });
    for (const [, , , row, count, spec] of extraHits(champ, ranks, championLevel, build, setup.extraHitSpecs)) {
      if (row) add(row, count);
      else { baseTotal += spec.flat * count; apRatioTotal += spec.ratio * count; }
    }
    for (const extra of Object.values(build.extras)) {
      baseTotal += extra.flat + extra.baseAdRatio * baseAd;
      apRatioTotal += extra.apRatio;
    }
    return [baseTotal, apRatioTotal, adRatioTotal];
  }

  const pctIncrease = (buildDamage, baselineDamage) =>
    buildDamage.map((value, index) => (baselineDamage[index] <= 0 ? 0 : (value / baselineDamage[index] - 1) * 100));
  const itemsFromNames = (names) => names.filter(Boolean).map((name) => itemByName[name]).filter(Boolean);

  function breakdown(setup, build, resist) {
    const rows = [];
    for (const [label, damageType, damage] of walkCombo(setup.champ, setup.combo, setup.ranks, setup.championLevel, build, setup.abilityMultipliers, setup.pressTheAttack)) {
      rows.push([label, damageType, damage]);
    }
    for (const [label, damageType, damage] of extraHits(setup.champ, setup.ranks, setup.championLevel, build, setup.extraHitSpecs)) {
      rows.push([label, damageType, damage]);
    }
    const baseAd = estimateBaseAd(build.cost);
    for (const [damageType, extra] of Object.entries(build.extras)) {
      const total = itemProcTotal(extra, build, baseAd);
      if (total) rows.push([`Item procs (${damageType})`, damageType, total]);
    }
    const apTotal = build.ap * build.apMult;
    const totalAd = baseAd + build.bonusAd;
    const pools = comboDamageByType(setup, build);
    const magicPercentPen = combinePercent(build.percentPen, setup.bonusPercentPen);
    const effectiveMr = resist * (1 - magicPercentPen) - build.flatPen;
    const effectiveArmor = resist * (1 - build.percentArmorPen) - build.flatArmorPen;
    const magicFinal = applyResist(pools.magic, resist, build.flatPen, magicPercentPen);
    const physicalFinal = applyResist(pools.physical, resist, build.flatArmorPen, build.percentArmorPen);
    const finalDamage = (magicFinal + physicalFinal) * build.dmgMult;
    let percentPenNote = `% pen ${(magicPercentPen * 100).toFixed(1)}%`;
    if (setup.bonusPercentPen) percentPenNote += ` (incl. ${(setup.bonusPercentPen * 100).toFixed(1)}% shred)`;

    const lines = [
      `Total AP: <strong>${apTotal.toFixed(0)}</strong>` + (build.apMult !== 1 ? ` (${build.ap.toFixed(0)} × ${build.apMult.toFixed(2)})` : ""),
      `Total AD: <strong>${totalAd.toFixed(1)}</strong> (${baseAd.toFixed(1)} base from ${build.cost.toFixed(0)} gold + ${build.bonusAd.toFixed(0)} bonus)`,
    ];
    if (build.critChance) {
      lines.push(`Crit chance: <strong>${(build.critChance * 100).toFixed(0)}%</strong> (crit deals ${((BASE_CRIT_MULTIPLIER + build.critDamage) * 100).toFixed(0)}%, so critable hits average ×${critExpectation(build).toFixed(3)})`);
    }
    if (pools.magic) {
      lines.push(`Magic: <strong>${pools.magic.toFixed(1)}</strong> raw → effective MR ${effectiveMr.toFixed(1)} (flat pen ${build.flatPen.toFixed(0)}, ${percentPenNote}) → <strong>${magicFinal.toFixed(1)}</strong>`);
    }
    if (pools.physical) {
      lines.push(`Physical: <strong>${pools.physical.toFixed(1)}</strong> raw → effective armour ${effectiveArmor.toFixed(1)} (flat pen ${build.flatArmorPen.toFixed(0)}, % pen ${(build.percentArmorPen * 100).toFixed(1)}%) → <strong>${physicalFinal.toFixed(1)}</strong>`);
    }
    if (build.dmgMult !== 1) lines.push(`Damage multiplier: <strong>${build.dmgMult.toFixed(2)}</strong>`);
    lines.push(`Final damage: <strong>${finalDamage.toFixed(1)}</strong>`);
    return { rows, lines };
  }

  // ---------------------------------------------------------------- UI state
  const calcState = {
    champ: DEFAULT_CHAMPION,
    combo: "QEWAR",
    ranks: { Q: 5, W: 3, E: 1, R: 2 },
    specialByChampion: {},   // champ -> {optionIndex: value}
    itemSpecial: {},         // item name -> value
    runes: {},               // rune name -> activations
    pressTheAttack: false,
    mode: MODE_BUILDS,
    controlForGold: false,
    midLaneQuest: false,
    buildA: Array(6).fill(""),
    buildB: Array(6).fill(""),
    core: Array(6).fill(""),
    options: Array(2).fill(""),
    breakdownResist: BREAKDOWN_DEFAULT_RESIST,
    breakdownOpen: false,
  };
  function saveCalcState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(calcState)); } catch { /* storage off: settings just don't persist */ }
  }
  // Returns whether there were saved settings to restore.
  function restoreCalcState() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { saved = null; }
    if (!saved || typeof saved !== "object") return false;
    for (const key of Object.keys(calcState)) if (key in saved) calcState[key] = saved[key];
    return true;
  }

  // What a typical player of this champion has at level 11: its skill points, and its items in
  // every build (Build A, Build B and the core build). The combo is left as typed.
  function applyChampionDefaults(champ) {
    const defaults = expectedGold?.champions?.[champ];
    if (!defaults) return;
    if (defaults.default_ranks) calcState.ranks = { ...defaults.default_ranks };
    if (defaults.default_items) {
      calcState.buildA = [...defaults.default_items];
      calcState.buildB = [...defaults.default_items];
      calcState.core = [...defaults.default_items];
    }
  }

  const escapeText = (text) => String(text).replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);

  function currentSetup() {
    const champ = calcState.champ;
    const championLevel = Math.min(Object.keys(ABILITY_MAX_RANKS).reduce((total, ability) => total + (calcState.ranks[ability] || 0), 0), MAX_CHAMPION_LEVEL);
    const ranks = { ...calcState.ranks };
    for (const [alias, sourceAbility] of Object.entries(RANK_ALIASES[champ] || {})) ranks[alias] = ranks[sourceAbility];

    const abilityMultipliers = {};
    const extraHitSpecs = [];
    let bonusPercentPen = 0;
    const chosen = calcState.specialByChampion[champ] || {};
    (CHAMPION_SPECIAL_OPTIONS[champ] || []).forEach((option, index) => {
      const value = chosen[index] ?? option.default;
      if (option.kind === "scale") abilityMultipliers[option.ability] = value;
      else if (option.kind === "stacks") extraHitSpecs.push({ count: value, ability: option.ability, label: option.label });
      else if (option.kind === "shred") bonusPercentPen = combinePercent(bonusPercentPen, option.choices[value] ?? 0);
    });
    for (const [runeName, rune] of Object.entries(RUNE_OPTIONS)) {
      extraHitSpecs.push({
        count: calcState.runes[runeName] ?? rune.default, label: runeName,
        flat: interpolateByLevel(rune.damageAtLevel1, rune.damageAtLevel18, championLevel), ratio: rune.apRatio / 100,
      });
    }
    const availableAbilities = new Set((abilityRowsByChampion[champ] || []).map((row) => row.ability));
    const combo = calcState.combo.replace(/\s/g, "").toUpperCase().split("")
      .filter((token) => token === ATTACK_TOKEN || availableAbilities.has(token));
    return { champ, combo, ranks, championLevel, abilityMultipliers, extraHitSpecs, bonusPercentPen, pressTheAttack: calcState.pressTheAttack };
  }

  const selectedItemNames = () => (calcState.mode === MODE_BUILDS
    ? [...calcState.buildA, ...calcState.buildB] : [...calcState.core, ...calcState.options]);

  function itemOptionValues() {
    const itemMultipliers = {};
    const itemStackCounts = {};
    const selected = new Set(selectedItemNames());
    for (const [itemName, options] of Object.entries(ITEM_SPECIAL_OPTIONS)) {
      if (!selected.has(itemName)) continue;
      for (const option of options) {
        const value = calcState.itemSpecial[itemName] ?? option.default;
        if (option.kind === "item_stacks") itemStackCounts[itemName] = value;
        else itemMultipliers[itemName] = value;
      }
    }
    return { itemMultipliers, itemStackCounts };
  }

  // ---------------------------------------------------------------- rendering
  const root = () => document.getElementById("calculator");
  const optionTags = (choices, current) => choices.map((choice) => {
    const [value, label] = Array.isArray(choice) ? choice : [choice, choice];
    return `<option value="${escapeText(value)}"${String(value) === String(current) ? " selected" : ""}>${escapeText(label)}</option>`;
  }).join("");
  // One dropdown per slot. A native <select> can't lay its list out in columns, so this is a button
  // styled like the other selects; it opens a list with AD items on the left and AP items on the right.
  const itemSelect = (listName, slot, current) => `<div class="item-picker">
    <button type="button" class="item-picker-button" data-picker-list="${listName}" data-picker-slot="${slot}"
      aria-haspopup="listbox" aria-expanded="false" aria-label="${listName} item ${slot + 1}">${escapeText(current || "—")}</button></div>`;

  function itemPickerTable(current, bootsOnly) {
    const cell = (name) => (name
      ? `<td><button type="button" role="option" data-pick-item="${escapeText(name)}" aria-selected="${name === current}">${escapeText(name)}</button></td>`
      : `<td aria-hidden="true"></td>`);
    const emptyRow = (columnSpan) =>
      `<tr><td colspan="${columnSpan}"><button type="button" role="option" data-pick-item="" aria-selected="${!current}">— (empty slot)</button></td></tr>`;
    if (bootsOnly) {
      return `<div class="item-picker-list single-column" role="listbox">
        <table><thead><tr><th>Boots</th></tr></thead>
        <tbody>${emptyRow(1)}${itemNamesByKind.boots.map((name) => `<tr>${cell(name)}</tr>`).join("")}</tbody></table></div>`;
    }
    const adNames = itemNamesByKind.ad;
    const apNames = itemNamesByKind.ap;
    // The shorter column is padded with blank cells so every row has both sides.
    const rowCount = Math.max(adNames.length, apNames.length);
    const rows = Array.from({ length: rowCount }, (_, index) => `<tr>${cell(adNames[index])}${cell(apNames[index])}</tr>`).join("");
    return `<div class="item-picker-list" role="listbox">
      <table><thead><tr><th>AD</th><th>AP</th></tr></thead>
      <tbody>${emptyRow(2)}${rows}</tbody></table></div>`;
  }

  function closeItemPicker() {
    document.querySelectorAll(".item-picker-list").forEach((list) => list.remove());
    document.querySelectorAll('.item-picker-button[aria-expanded="true"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  function openItemPicker(button) {
    closeItemPicker();
    const listName = button.dataset.pickerList;
    const slot = Number(button.dataset.pickerSlot);
    button.insertAdjacentHTML("afterend", itemPickerTable(calcState[listName][slot], isBootsSlot(listName, slot)));
    button.setAttribute("aria-expanded", "true");
    const list = button.nextElementSibling;
    // Open toward whichever side has room, so the right-hand build's list stays on screen.
    if (button.getBoundingClientRect().left + list.offsetWidth > document.documentElement.clientWidth - 8) list.classList.add("align-right");
    (list.querySelector('[aria-selected="true"]') || list.querySelector("button")).focus();
  }

  function renderControls() {
    const champ = calcState.champ;
    const setup = currentSetup();
    const champions = Object.keys(abilityRowsByChampion).sort((first, second) => first.localeCompare(second));
    const chosen = calcState.specialByChampion[champ] || {};
    const specialControls = (CHAMPION_SPECIAL_OPTIONS[champ] || []).map((option, index) => {
      const value = chosen[index] ?? option.default;
      const choices = option.kind === "shred" ? Object.keys(option.choices) : option.choices;
      return `<label class="calc-field"><span class="eyebrow">${escapeText(option.label)}</span><select data-champ-special="${index}">${optionTags(choices, value)}</select></label>`;
    });
    const selected = new Set(selectedItemNames());
    for (const [itemName, options] of Object.entries(ITEM_SPECIAL_OPTIONS)) {
      if (!selected.has(itemName)) continue;
      for (const option of options) {
        const value = calcState.itemSpecial[itemName] ?? option.default;
        if (option.kind === "item_stacks") {
          specialControls.push(`<label class="calc-field"><span class="eyebrow">${escapeText(option.label)}: <output>${value}</output></span><input type="range" min="${option.min}" max="${option.max}" value="${value}" data-item-special="${escapeText(itemName)}"></label>`);
        } else {
          specialControls.push(`<label class="calc-field"><span class="eyebrow">${escapeText(option.label)}</span><select data-item-special="${escapeText(itemName)}">${optionTags(option.choices, value)}</select></label>`);
        }
      }
    }
    const runeControls = Object.entries(RUNE_OPTIONS).map(([runeName, rune]) =>
      `<label class="calc-field"><span class="eyebrow">${escapeText(rune.label)}</span><select data-rune="${escapeText(runeName)}">${optionTags(rune.choices, calcState.runes[runeName] ?? rune.default)}</select></label>`).join("");

    document.getElementById("calc-controls").innerHTML = `
      <label class="calc-field"><span class="eyebrow">Champion</span><select id="calc-champ">${optionTags(champions, champ)}</select></label>
      <label class="calc-field"><span class="eyebrow">Combo</span><input class="search" id="calc-combo" type="text" value="${escapeText(calcState.combo)}" placeholder="e.g. QAWAR" autocomplete="off" spellcheck="false"><span class="calc-hint">Input "a" for an attack — QAWAR is Q, attack, W, attack, R.</span></label>
      <div class="calc-field"><span class="eyebrow">Ability ranks</span><div class="calc-ranks">${Object.entries(ABILITY_MAX_RANKS).map(([ability, maxRank]) =>
        `<label><span>${ability}</span><select data-rank="${ability}">${optionTags(Array.from({ length: maxRank + 1 }, (_, rank) => rank), calcState.ranks[ability] || 0)}</select></label>`).join("")}</div>
        <span class="calc-hint">Champion level ${setup.championLevel} (from ability points)</span></div>
      ${specialControls.length ? `<h3 class="calc-group-title">Special</h3>${specialControls.join("")}` : ""}
      <h3 class="calc-group-title">Runes</h3>
      ${runeControls}
      <label class="toggle"><input type="checkbox" id="calc-pta" role="switch"${calcState.pressTheAttack ? " checked" : ""}><span class="toggle-track" aria-hidden="true"></span><span title="Procs on the 3rd attack typed into the combo, then amplifies the rest of the combo by 8%.">Press the Attack</span></label>`;
  }

  function buildCaption(build) { return `${(build.ap * build.apMult).toFixed(0)} AP · ${build.cost.toFixed(0)} gold`; }

  // Shop price of the build against the gold a typical player of this champion has earned on reaching
  // this level (median of recent Diamond+ games). Red: the build needs a gold lead. Green: it fits.
  function goldWarning(names, championLevel) {
    const champion = expectedGold?.champions?.[calcState.champ];
    const buildItems = itemsFromNames(names);
    if (!champion || championLevel < 1 || !buildItems.length) return "";
    const price = buildItems.reduce((total, item) => total + (Number(item.Price) || 0), 0);
    const typicalGold = champion.gold_by_level[championLevel - 1];
    if (typicalGold == null) {
      return `<p class="calc-hint">Too few ${escapeText(calcState.champ)} games reach level ${championLevel} for a typical-gold figure.</p>`;
    }
    const difference = price - typicalGold;
    const isOver = difference > 0;
    const format = (value) => Math.round(value).toLocaleString("en-US");
    const tooltip = `Build price ${format(price)} gold vs ${format(typicalGold)} gold earned by a typical ${calcState.champ} ` +
      `(${champion.position.toLowerCase()}) on reaching level ${championLevel}, the median of ${champion.games} recent Diamond+ games.`;
    return `<p class="calc-gold-warning ${isOver ? "is-over" : "is-under"} tabular" title="${escapeText(tooltip)}">` +
      `${isOver ? "▲" : "▼"} ${format(Math.abs(difference))} gold ${isOver ? "above" : "below"} a typical ${escapeText(calcState.champ)} at level ${championLevel}</p>`;
  }

  function renderBuilds(builds, baselineBuild, championLevel) {
    const container = document.getElementById("calc-builds");
    if (calcState.mode === MODE_BUILDS) {
      container.innerHTML = ["A", "B"].map((letter, index) => {
        const listName = letter === "A" ? "buildA" : "buildB";
        return `<div class="calc-build" style="--series:${SERIES_COLORS[index]}"><h3>Build ${letter}</h3>
          <div class="calc-slots">${calcState[listName].map((name, slot) => itemSelect(listName, slot, name)).join("")}</div>
          <p class="calc-hint tabular">${buildCaption(builds[index][1])}</p>
          ${goldWarning(calcState[listName], championLevel)}</div>`;
      }).join("");
    } else {
      container.innerHTML = `<div class="calc-build"><h3>Core build</h3>
          <div class="calc-slots">${calcState.core.map((name, slot) => itemSelect("core", slot, name)).join("")}</div>
          <p class="calc-hint tabular">${buildCaption(baselineBuild)}</p>
          ${goldWarning(calcState.core, championLevel)}</div>
        <div class="calc-build"><h3>Next item options</h3>
          <div class="calc-slots">${calcState.options.map((name, slot) =>
            `<div class="calc-option" style="--series:${SERIES_COLORS[slot]}">${itemSelect("options", slot, name)}</div>`).join("")}</div>
          ${calcState.options.filter(Boolean).map((name) => `<p class="calc-hint tabular">${escapeText(name)}: ${Number(itemByName[name]?.Cost || 0).toFixed(0)} gold</p>
            ${goldWarning([...calcState.core, name], championLevel)}`).join("")}</div>`;
    }
  }

  function niceStep(range) {
    const rough = range / 5;
    const magnitude = 10 ** Math.floor(Math.log10(rough || 1));
    const scaled = rough / magnitude;
    return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * magnitude;
  }

  function renderChart(title, yLabel, series, goldNote) {
    const width = 820;
    const height = 420;
    const margin = { top: 16, right: 22, bottom: 52, left: 64 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const allValues = series.flatMap((line) => line.values);
    const yMin = Math.min(0, ...allValues);
    const step = niceStep(Math.max(...allValues, 1) - yMin);
    const yMax = Math.ceil(Math.max(...allValues, step) / step) * step;
    const yBottom = Math.floor(yMin / step) * step;
    const xScale = (resist) => margin.left + (resist - RESIST_VALUES[0]) / (RESIST_VALUES.at(-1) - RESIST_VALUES[0]) * plotWidth;
    const yScale = (value) => margin.top + (1 - (value - yBottom) / (yMax - yBottom)) * plotHeight;

    let grid = "";
    for (let value = yBottom; value <= yMax + step / 2; value += step) {
      grid += `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yScale(value)}" y2="${yScale(value)}" class="calc-grid"/>
        <text x="${margin.left - 8}" y="${yScale(value) + 4}" text-anchor="end" class="calc-tick">${Number(value.toFixed(2))}%</text>`;
    }
    for (let resist = 25; resist <= 150; resist += 25) {
      grid += `<text x="${xScale(resist)}" y="${height - margin.bottom + 20}" text-anchor="middle" class="calc-tick">${resist}</text>`;
    }
    const lines = series.map((line) => `<polyline fill="none" stroke="${line.color}" stroke-width="3" stroke-linejoin="round" points="${
      line.values.map((value, index) => `${xScale(RESIST_VALUES[index]).toFixed(1)},${yScale(value).toFixed(1)}`).join(" ")}"/>`).join("");

    document.getElementById("calc-chart").innerHTML = `
      <h3 class="calc-chart-title">${escapeText(title)}</h3>
      ${goldNote ? `<p class="calc-hint">${escapeText(goldNote)}</p>` : ""}
      <div class="legend">${series.map((line) => `<span class="legend-item"><svg width="18" height="4"><rect width="18" height="4" rx="2" fill="${line.color}"/></svg>${escapeText(line.label)}</span>`).join("")}</div>
      <div class="calc-chart-frame">
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeText(title)}">
          ${grid}
          <text x="${margin.left + plotWidth / 2}" y="${height - 10}" text-anchor="middle" class="calc-axis-label">Enemy resist (armour / MR)</text>
          <text transform="translate(16 ${margin.top + plotHeight / 2}) rotate(-90)" text-anchor="middle" class="calc-axis-label">${escapeText(yLabel)}</text>
          ${lines}
          <line id="calc-hover-line" y1="${margin.top}" y2="${margin.top + plotHeight}" class="calc-hover-line" visibility="hidden"/>
          <rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${plotHeight}" fill="transparent" id="calc-hover-target"/>
        </svg>
        <div class="tooltip calc-tooltip" id="calc-tooltip" hidden></div>
      </div>`;

    const svg = document.querySelector("#calc-chart svg");
    const hoverLine = document.getElementById("calc-hover-line");
    const tooltip = document.getElementById("calc-tooltip");
    const target = document.getElementById("calc-hover-target");
    target.addEventListener("mousemove", (event) => {
      const box = svg.getBoundingClientRect();
      const svgX = (event.clientX - box.left) / box.width * width;
      const index = clamp(Math.round((svgX - margin.left) / plotWidth * (RESIST_VALUES.length - 1)), 0, RESIST_VALUES.length - 1);
      const x = xScale(RESIST_VALUES[index]);
      hoverLine.setAttribute("x1", x);
      hoverLine.setAttribute("x2", x);
      hoverLine.setAttribute("visibility", "visible");
      tooltip.innerHTML = `<h4>Resist ${RESIST_VALUES[index]}</h4><dl>${series.map((line) =>
        `<dt><span style="color:${line.color}">●</span> ${escapeText(line.label)}</dt><dd>${line.values[index].toFixed(1)}%</dd>`).join("")}</dl>`;
      tooltip.hidden = false;
      const frame = tooltip.parentElement.getBoundingClientRect();
      const left = event.clientX - frame.left + 14;
      tooltip.style.left = `${Math.min(left, frame.width - tooltip.offsetWidth - 4)}px`;
      tooltip.style.top = `${event.clientY - frame.top + 14}px`;
    });
    target.addEventListener("mouseleave", () => { hoverLine.setAttribute("visibility", "hidden"); tooltip.hidden = true; });
  }

  function renderBreakdown(setup, baselineLabel, baselineBuild, builds) {
    const resist = calcState.breakdownResist;
    const columns = [[`Baseline (${baselineLabel})`, baselineBuild, null], ...builds.map(([label, build], index) => [label, build, SERIES_COLORS[index]])];
    document.getElementById("calc-breakdown-body").innerHTML = `
      <label class="calc-field calc-resist"><span class="eyebrow">Enemy resist (armour / MR): <output>${resist}</output></span>
        <input type="range" min="0" max="200" value="${resist}" id="calc-breakdown-resist"></label>
      <div class="calc-breakdown-grid">${columns.map(([label, build, color]) => {
        const { rows, lines } = breakdown(setup, build, resist);
        return `<div class="calc-breakdown-column"${color ? ` style="--series:${color}"` : ""}>
          <h4>${escapeText(label)}</h4>
          <div class="table-wrap"><table class="small-table calc-table"><thead><tr><th>Source</th><th>Type</th><th class="numeric">Damage</th></tr></thead>
          <tbody>${rows.map(([source, damageType, damage]) => `<tr><td>${escapeText(source)}</td><td>${damageType}</td><td class="numeric">${damage.toFixed(1)}</td></tr>`).join("") || `<tr><td colspan="3" class="low-data">No hits</td></tr>`}</tbody></table></div>
          <ul class="calc-summary">${lines.map((line) => `<li>${line}</li>`).join("")}</ul></div>`;
      }).join("")}</div>`;
  }

  function renderCalculator() {
    if (!calcState.champ || !abilityRowsByChampion[calcState.champ]) {
      calcState.champ = abilityRowsByChampion[DEFAULT_CHAMPION] ? DEFAULT_CHAMPION : Object.keys(abilityRowsByChampion).sort()[0] || "";
    }
    const setup = currentSetup();
    const { itemMultipliers, itemStackCounts } = itemOptionValues();
    const questApMult = calcState.midLaneQuest ? MID_LANE_QUEST_AP_MULT : 1;
    const summarize = (names) => summarizeBuild(itemsFromNames(names), itemMultipliers, itemStackCounts, setup.championLevel, questApMult);

    let builds;
    let baselineBuild;
    let baselineLabel;
    if (calcState.mode === MODE_BUILDS) {
      builds = [["Build A", summarize(calcState.buildA)], ["Build B", summarize(calcState.buildB)]];
      baselineBuild = summarizeBuild([]);
      baselineLabel = "no items";
    } else {
      baselineBuild = summarize(calcState.core);
      baselineLabel = "core build";
      builds = calcState.options.map((optionName) => [optionName || "(No item)", summarize([...calcState.core, optionName])]);
    }

    renderControls();
    renderBuilds(builds, baselineBuild, setup.championLevel);
    document.querySelectorAll('#calculator input[name="calc-mode"]').forEach((input) => { input.checked = input.value === calcState.mode; });
    document.getElementById("calc-gold").checked = calcState.controlForGold;
    document.getElementById("calc-quest").checked = calcState.midLaneQuest;

    const chart = document.getElementById("calc-chart");
    const breakdownSection = document.getElementById("calc-breakdown");
    if (!setup.combo.length) {
      chart.innerHTML = `<p class="notice">Enter a combo using this champion's abilities to see the chart.</p>`;
      breakdownSection.hidden = true;
      return;
    }
    breakdownSection.hidden = false;

    const baselineDamage = RESIST_VALUES.map((resist) => comboDamageVsResist(setup, baselineBuild, resist));
    // Gold control: the cheapest option stays as it is; dearer ones scale down by how much more they cost.
    const goldOverBaseline = builds.map(([, build]) => build.cost - baselineBuild.cost);
    const positiveGold = goldOverBaseline.filter((gold) => gold > 0);
    const cheapestGold = positiveGold.length ? Math.min(...positiveGold) : 0;
    const series = builds.map(([label, build], index) => {
      let values = pctIncrease(RESIST_VALUES.map((resist) => comboDamageVsResist(setup, build, resist)), baselineDamage);
      if (calcState.controlForGold && cheapestGold > 0 && goldOverBaseline[index] > cheapestGold) {
        const priceRatio = cheapestGold / goldOverBaseline[index];
        values = values.map((value) => value * priceRatio);
      }
      return { label, color: SERIES_COLORS[index], values };
    });
    const [comboBase, comboApRatio, comboAdRatio] = comboBaseAndRatio(setup, baselineBuild);
    const scalingParts = [];
    if (comboApRatio) scalingParts.push(`${(comboApRatio * 100).toFixed(0)}% AP`);
    if (comboAdRatio) scalingParts.push(`${(comboAdRatio * 100).toFixed(0)}% AD`);
    const title = `${setup.champ} ${setup.combo.join("")} (${comboBase.toFixed(0)} base dmg + ${scalingParts.join(" + ") || "no scaling"})`;
    const yLabel = `% damage increase vs ${baselineLabel}`;
    const goldNote = calcState.controlForGold && cheapestGold > 0 ? `Normalised to ${cheapestGold.toFixed(0)} gold: the pricier option is scaled down by how much more it costs.` : "";
    renderChart(title, yLabel, series, goldNote);
    breakdownSection.open = calcState.breakdownOpen;
    renderBreakdown(setup, baselineLabel, baselineBuild, builds);
  }

  // ---------------------------------------------------------------- events
  function changeMode(newMode) {
    if (newMode === calcState.mode) return;
    if (newMode === MODE_NEXT) calcState.core = [...calcState.buildA];   // Build A becomes the core; last options return.
    else { calcState.buildA = [...calcState.core]; calcState.buildB = [...calcState.core]; }   // the core fills both builds
    calcState.mode = newMode;
  }

  function wireEvents() {
    const section = root();
    section.addEventListener("change", (event) => {
      const input = event.target;
      if (input.id === "calc-champ") {
        calcState.champ = input.value;
        applyChampionDefaults(calcState.champ);
        syncQuestToBoots();
      }
      else if (input.dataset.rank) calcState.ranks[input.dataset.rank] = Number(input.value);
      else if (input.dataset.champSpecial !== undefined) {
        const option = CHAMPION_SPECIAL_OPTIONS[calcState.champ][Number(input.dataset.champSpecial)];
        calcState.specialByChampion[calcState.champ] = calcState.specialByChampion[calcState.champ] || {};
        calcState.specialByChampion[calcState.champ][input.dataset.champSpecial] = option.kind === "shred" ? input.value : Number(input.value);
      } else if (input.dataset.itemSpecial) calcState.itemSpecial[input.dataset.itemSpecial] = Number(input.value);
      else if (input.dataset.rune) calcState.runes[input.dataset.rune] = Number(input.value);
      else if (input.id === "calc-pta") calcState.pressTheAttack = input.checked;
      else if (input.name === "calc-mode") {
        changeMode(input.value);
        syncQuestToBoots();
      }
      else if (input.id === "calc-gold") calcState.controlForGold = input.checked;
      else if (input.id === "calc-quest") calcState.midLaneQuest = input.checked;
      else return;
      saveCalcState();
      renderCalculator();
    });

    // Item dropdowns: the button opens the two-column list; a cell picks that item for the slot.
    section.addEventListener("click", (event) => {
      const pick = event.target.closest("[data-pick-item]");
      if (pick) {
        const button = pick.closest(".item-picker").querySelector(".item-picker-button");
        const listName = button.dataset.pickerList;
        const slot = Number(button.dataset.pickerSlot);
        calcState[listName][slot] = pick.dataset.pickItem;
        if (isBootsSlot(listName, slot)) syncQuestToBoots();
        closeItemPicker();
        saveCalcState();
        renderCalculator();
        document.querySelector(`.item-picker-button[data-picker-list="${listName}"][data-picker-slot="${slot}"]`)?.focus();
        return;
      }
      const button = event.target.closest(".item-picker-button");
      if (!button) return;
      if (button.getAttribute("aria-expanded") === "true") closeItemPicker();
      else openItemPicker(button);
    });
    document.addEventListener("click", (event) => { if (!event.target.closest(".item-picker")) closeItemPicker(); });
    section.addEventListener("keydown", (event) => {
      const list = event.target.closest(".item-picker-list");
      if (!list) return;
      if (event.key === "Escape") {
        const button = list.previousElementSibling;
        closeItemPicker();
        button.focus();
        return;
      }
      // Arrows move through the grid: up/down within a column, left/right across the middle line.
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (!moves[event.key]) return;
      event.preventDefault();
      const rows = [...list.querySelectorAll("tbody tr")];
      const cell = event.target.closest("td");
      let rowIndex = rows.indexOf(cell.parentElement);
      let columnIndex = cell.colSpan === 2 ? 0 : cell.cellIndex;
      const [rowStep, columnStep] = moves[event.key];
      for (let attempt = 0; attempt < rows.length; attempt++) {
        rowIndex = clamp(rowIndex + rowStep, 0, rows.length - 1);
        columnIndex = clamp(columnIndex + columnStep, 0, 1);
        const target = rows[rowIndex].cells[Math.min(columnIndex, rows[rowIndex].cells.length - 1)]?.querySelector("button");
        if (target) { target.focus(); return; }
        if (!rowStep) return;   // a blank cell sideways: stay put
      }
    });
    section.addEventListener("input", (event) => {
      const input = event.target;
      if (input.id === "calc-combo") {
        calcState.combo = input.value;
        saveCalcState();
        const caret = input.selectionStart;
        renderCalculator();
        const comboInput = document.getElementById("calc-combo");
        comboInput.focus();
        comboInput.setSelectionRange(caret, caret);
      } else if (input.id === "calc-breakdown-resist") {
        calcState.breakdownResist = Number(input.value);
        saveCalcState();
        renderBreakdown(currentSetup(), ...breakdownInputs());
        document.getElementById("calc-breakdown-resist").focus();
      } else if (input.dataset.itemSpecial && input.type === "range") {
        input.previousElementSibling.querySelector("output").textContent = input.value;
      }
    });
    document.getElementById("calc-breakdown").addEventListener("toggle", (event) => {
      calcState.breakdownOpen = event.target.open;
      saveCalcState();
    });
  }

  // The breakdown slider re-renders only the breakdown, so it rebuilds the builds the same way renderCalculator does.
  function breakdownInputs() {
    const setup = currentSetup();
    const { itemMultipliers, itemStackCounts } = itemOptionValues();
    const questApMult = calcState.midLaneQuest ? MID_LANE_QUEST_AP_MULT : 1;
    const summarize = (names) => summarizeBuild(itemsFromNames(names), itemMultipliers, itemStackCounts, setup.championLevel, questApMult);
    if (calcState.mode === MODE_BUILDS) {
      return ["no items", summarizeBuild([]), [["Build A", summarize(calcState.buildA)], ["Build B", summarize(calcState.buildB)]]];
    }
    return ["core build", summarize(calcState.core),
      calcState.options.map((optionName) => [optionName || "(No item)", summarize([...calcState.core, optionName])])];
  }

  // ---------------------------------------------------------------- page switching
  let loaded = false;
  async function loadData() {
    if (loaded) return true;
    const response = await fetch("calculator-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`calculator-data.json returned ${response.status}`);
    const payload = await response.json();
    abilityRowsByChampion = {};
    for (const row of payload.abilities) {
      (abilityRowsByChampion[row.Champ] = abilityRowsByChampion[row.Champ] || []).push({
        ability: row.Ability, rank: Number(row.Rank), base: Number(row.BaseDamage),
        apRatio: Number(row.APRatio) / 100, adRatio: (Number(row.ADRatio) || 0) / 100,
        bonusAdRatio: (Number(row.BonusADRatio) || 0) / 100, damageType: row.DamageType || "magic",
      });
    }
    itemByName = Object.fromEntries(payload.items.map((item) => [item.Item, item]));
    const isAdItem = (item) => Number(item.AD) > 0 || Number(item.CritChance) > 0 || Number(item.FlatArmorPen) > 0
      || Number(item.PercentArmorPen) > 0 || ITEM_EXTRA_DAMAGE_TYPE[item.Item] === "physical";
    const namesAtoZ = (items) => items.map((item) => item.Item).sort((first, second) => first.localeCompare(second));
    // expected-gold.json carries the gold warning, each champion's level-11 defaults and the boots list.
    // It is optional: without it the calculator still works.
    try {
      const goldResponse = await fetch("expected-gold.json", { cache: "no-store" });
      expectedGold = goldResponse.ok ? await goldResponse.json() : null;
    } catch { expectedGold = null; }
    const bootsNames = new Set(expectedGold?.boots || FALLBACK_BOOTS);
    const isBoots = (item) => bootsNames.has(item.Item);
    itemNamesByKind = {
      boots: namesAtoZ(payload.items.filter(isBoots)),
      ad: namesAtoZ(payload.items.filter((item) => !isBoots(item) && isAdItem(item))),
      ap: namesAtoZ(payload.items.filter((item) => !isBoots(item) && !isAdItem(item))),
    };
    document.getElementById("calc-data-note").textContent = payload.note || "";
    loaded = true;
    return true;
  }

  const counterSheetSections = () => ["filters", "app", "method", "status-line"].map((id) => document.getElementById(id));
  const calculatorButton = document.getElementById("calc-switch");
  const sheetSwitch = document.getElementById("sheet-switch");

  async function openCalculator() {
    counterSheetSections().forEach((element) => { if (element) element.hidden = true; });
    root().hidden = false;
    calculatorButton.setAttribute("aria-pressed", "true");
    sheetSwitch.classList.add("is-inactive");
    document.getElementById("sheet-dek").textContent = "How much more damage one build does than another, across every enemy resist. Pick a champion, type a combo, fill the builds.";
    document.title = "Build Calculator";
    if (location.hash !== "#calculator") history.replaceState(null, "", "#calculator");
    try {
      await loadData();
    } catch (error) {
      document.getElementById("calc-chart").innerHTML = `<p class="loading">Couldn't load the calculator data (${escapeText(error.message)}). Reload the page to try again.</p>`;
      return;
    }
    // A first visit starts from the default champion's typical level-11 build.
    if (!hadSavedSettings && !firstVisitDefaultsApplied) {
      applyChampionDefaults(calcState.champ);
      syncQuestToBoots();
      firstVisitDefaultsApplied = true;
    }
    renderCalculator();
  }

  function closeCalculator() {
    counterSheetSections().forEach((element) => { if (element) element.hidden = false; });
    root().hidden = true;
    calculatorButton.setAttribute("aria-pressed", "false");
    sheetSwitch.classList.remove("is-inactive");
    if (location.hash === "#calculator") history.replaceState(null, "", location.pathname + location.search);
    // The counter sheet's own render restores its title, dek and pressed tab.
    if (typeof syncFilterInputs === "function") syncFilterInputs();
  }

  const hadSavedSettings = restoreCalcState();
  let firstVisitDefaultsApplied = false;
  wireEvents();
  calculatorButton.addEventListener("click", () => { if (root().hidden) openCalculator(); });
  // Choosing either counter sheet leaves the calculator (the sheet's own handler switches sheets).
  sheetSwitch.addEventListener("click", (event) => { if (event.target.closest("button[data-sheet]") && !root().hidden) closeCalculator(); });
  if (location.hash === "#calculator") openCalculator();
})();
