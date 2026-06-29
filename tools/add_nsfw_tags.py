"""新增 NSFW 扩展标签：心理压迫、极端环境、身体极限、权力关系"""
import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NSFW_FILE = os.path.join(BASE_DIR, "data", "presets", "nsfw.json")

# 新增标签数据：[category_id, {id, name, prompt}]
NEW_TAGS = {
    # ========== 心理压迫 ==========
    "psychological": [
        {"id": "fear_expression", "name": "恐惧表情", "prompt": "fearful expression, terrified face, wide horrified eyes, pale face"},
        {"id": "despair", "name": "绝望", "prompt": "despair, hopeless expression, tears streaming down face, broken spirit"},
        {"id": "helplessness", "name": "无助感", "prompt": "helpless, trapped expression, pleading eyes, powerless posture"},
        {"id": "mental_breakdown", "name": "精神崩溃", "prompt": "mental breakdown, hysterical, screaming in agony, deranged expression, wild eyes"},
        {"id": "terror", "name": "恐怖", "prompt": "terror, petrified, frozen in fear, paralyzed by dread"},
        {"id": "panic_attack", "name": "恐慌发作", "prompt": "panic attack, hyperventilating, trembling, claustrophobic fear"},
        {"id": "trauma_response", "name": "创伤反应", "prompt": "trauma response, dissociated, blank stare, flashbacks, catatonic"},
        {"id": "nightmare_face", "name": "噩梦表情", "prompt": "nightmare face, haunted expression, sleep terror, waking from horror"},
        {"id": "phobia", "name": "恐惧症", "prompt": "phobia reaction, extreme fear response, retreating, cowering"},
        {"id": "guilt_expression", "name": "负罪感", "prompt": "guilty expression, remorseful face, shame, self-loathing"},
        {"id": "regret", "name": "悔恨", "prompt": "deep regret, anguish, wishing to undo, self-blame"},
        {"id": "shame_face", "name": "羞耻", "prompt": "overwhelming shame, blushing deeply, hiding face, humiliated"},
        {"id": "paranoia", "name": "偏执妄想", "prompt": "paranoid, suspicious gaze, watching shadows, conspiracy fear"},
        {"id": "derealization", "name": "现实解体", "prompt": "derealization, detached from reality, foggy perception, numb expression"},
        {"id": "intrusive_thoughts", "name": "侵入性思维", "prompt": "intrusive thoughts, disturbing mental images, uncontrollable dark thoughts"},
        {"id": "obsessive_fear", "name": "强迫性恐惧", "prompt": "obsessive fear, compulsive checking, ritualistic anxiety, phobic obsession"},
        {"id": "grief_face", "name": "悲痛表情", "prompt": "grief, mourning, devastating loss, heartbroken expression, weeping"},
        {"id": "loneliness", "name": "孤独", "prompt": "profound loneliness, isolated, abandoned, empty eyes, solitary figure"},
        {"id": "anxiety_face", "name": "焦虑表情", "prompt": "anxiety, nervous, worried, restless, biting nails, fidgeting"},
        {"id": "stress_face", "name": "压力", "prompt": "extreme stress, overwhelmed, pressure building, about to snap"},
    ],

    # ========== 极端环境 ==========
    "extreme_environment": [
        {"id": "extreme_heat", "name": "极端高温", "prompt": "extreme heat, scorching temperature, melting environment, heat haze, sweating profusely"},
        {"id": "freezing_cold", "name": "极寒", "prompt": "freezing cold, frostbite, ice crystals, blue lips, shivering violently, frozen breath"},
        {"id": "hypothermia", "name": "失温", "prompt": "hypothermia, cold exposure, confused from cold, paradoxical undressing, fading consciousness"},
        {"id": "heatstroke", "name": "中暑", "prompt": "heatstroke, overheating, delirious from heat, collapsing, sunstroke"},
        {"id": "oxygen_deprivation", "name": "缺氧", "prompt": "oxygen deprivation, hypoxia, dizzy, vision tunneling, gasping for air"},
        {"id": "suffocation_feel", "name": "窒息感", "prompt": "suffocation feeling, choking, unable to breathe, desperate gasp, throat constricted"},
        {"id": "near_drowning", "name": "溺水边缘", "prompt": "near drowning, water filling lungs, panic underwater, bubbles, struggling to surface"},
        {"id": "altitude_sickness", "name": "高原反应", "prompt": "altitude sickness, thin air, dizzy at height, mountain hypoxia, impaired judgment"},
        {"id": "vacuum_exposure", "name": "真空暴露", "prompt": "vacuum exposure, space environment, no atmosphere, freezing and boiling simultaneously"},
        {"id": "pressure_depth", "name": "深海压力", "prompt": "deep sea pressure, crushing weight, underwater depth, bone-deep compression"},
        {"id": "volcanic_environment", "name": "火山环境", "prompt": "volcanic environment, lava, ash cloud, pyroclastic flow, extreme heat and toxic gas"},
        {"id": "sandstorm", "name": "沙尘暴", "prompt": "sandstorm, blinding dust, choking particles, howling wind, visibility zero"},
        {"id": "blizzard", "name": "暴风雪", "prompt": "blizzard, whiteout conditions, freezing wind, buried in snow, disoriented"},
        {"id": "hurricane_force", "name": "飓风", "prompt": "hurricane force winds, tornado, cyclone, debris flying, tornadic destruction"},
        {"id": "radiation_zone", "name": "辐射区域", "prompt": "radiation zone, glowing contamination, nuclear fallout, irradiated environment"},
        {"id": "toxic_gas", "name": "毒气", "prompt": "toxic gas, chemical cloud, poisonous atmosphere, green fog, corrosive air"},
        {"id": "lava_floor", "name": "熔岩地面", "prompt": "lava beneath feet, molten ground, fire pit, incandescent floor"},
        {"id": "abyss_edge", "name": "深渊边缘", "prompt": "edge of abyss, vertical drop, vertigo, looking into the void, height terror"},
        {"id": "magma_environment", "name": "岩浆环境", "prompt": "magma environment, flowing lava, volcanic eruption, extreme thermal radiation"},
        {"id": "ice_cave", "name": "冰洞", "prompt": "ice cave, frozen cavern, glacial interior, blue ice walls, subzero temperature"},
    ],

    # ========== 身体极限 ==========
    "physical_limit": [
        {"id": "exhaustion", "name": "力竭", "prompt": "complete exhaustion, drained energy, collapsing from fatigue, last strength"},
        {"id": "trembling", "name": "颤抖", "prompt": "trembling, shaking uncontrollably, quivering limbs, muscle spasms"},
        {"id": "collapse", "name": "虚脱倒地", "prompt": "collapsing, falling to knees, fainting, losing consciousness, body giving out"},
        {"id": "sweat_soaked", "name": "汗水浸透", "prompt": "sweat-soaked, drenched in perspiration, dripping wet, soaked clothes clinging"},
        {"id": "muscle_spasm", "name": "肌肉痉挛", "prompt": "muscle spasm, cramping, seizing, involuntary contractions, locked joints"},
        {"id": "overtraining", "name": "过度训练", "prompt": "overtraining, muscle failure, pushed beyond limits, redlining, maximum exertion"},
        {"id": "dehydration", "name": "脱水", "prompt": "dehydration, cracked lips, dry mouth, weak from lack of water, sunken eyes"},
        {"id": "starvation", "name": "饥饿虚弱", "prompt": "starvation weakness, emaciated, frail from hunger, wasting away"},
        {"id": "sleep_deprivation", "name": "睡眠剥夺", "prompt": "sleep deprivation, exhausted eyes, hallucinating from lack of sleep, zombie-like"},
        {"id": "pain_face", "name": "疼痛表情", "prompt": "intense pain, grimacing, agony, wincing, teeth clenched from hurt"},
        {"id": "burning_muscles", "name": "肌肉灼烧感", "prompt": "burning muscles, lactic acid build-up, fire in legs, exercise burn"},
        {"id": "joint_strain", "name": "关节劳损", "prompt": "joint strain, popping joints, swollen knees, cartilage stress"},
        {"id": "breathless", "name": "气喘吁吁", "prompt": "breathless, panting heavily, gasping, out of breath, chest heaving"},
        {"id": "limp_body", "name": "瘫软无力", "prompt": "limp body, boneless, jelly-like, completely relaxed and weak, falling apart"},
        {"id": "post_exercise", "name": "运动后虚脱", "prompt": "post-exercise collapse, spent, empty tank, recovery mode, collapsed athlete"},
        {"id": "bruised_body", "name": "淤青满身", "prompt": "bruised body, purple and yellow marks, battered, contusions everywhere"},
        {"id": "bleeding_minor", "name": "轻微出血", "prompt": "minor bleeding, cuts and scrapes, blood from wounds, bleeding hands"},
        {"id": "friction_burn", "name": "摩擦灼伤", "prompt": "friction burn, chafed skin, raw and red, abraded skin, rope burns"},
        {"id": "cramps_full_body", "name": "全身抽筋", "prompt": "full body cramps, convulsions, rigid muscles, locked in pain"},
        {"id": "weak_knees", "name": "双腿发软", "prompt": "weak knees, legs buckling, can't stand, collapsing legs, unstable stance"},
    ],

    # ========== 权力关系 ==========
    "power_dynamics": [
        {"id": "prostration", "name": "跪拜", "prompt": "prostration, full bow to ground, forehead touching floor, worship posture, kneeling submission"},
        {"id": "submission_pose", "name": "臣服姿态", "prompt": "submission pose, lowered head, hands behind back, submissive stance, yielding posture"},
        {"id": "looking_up", "name": "仰望", "prompt": "looking up, upward gaze, admiring from below, neck craned upward, deferential angle"},
        {"id": "looking_down", "name": "俯视", "prompt": "looking down, downward gaze, dominant angle, towering over, condescending view"},
        {"id": "chain_bound", "name": "锁链束缚", "prompt": "chain bound, heavy chains, iron shackles, restrained by metal links, chained wrists"},
        {"id": "handcuffed", "name": "手铐束缚", "prompt": "handcuffed, metal handcuffs, restrained wrists, cuffed behind back"},
        {"id": "ankle_chains", "name": "脚镣", "prompt": "ankle chains, iron shackles on feet, restricted movement, chained ankles"},
        {"id": "collar_submissive", "name": "项圈", "prompt": "wearing collar, submissive collar, pet collar, marked ownership, leather collar"},
        {"id": "kneeling_before", "name": "在...面前跪下", "prompt": "kneeling before someone, subservient kneeling, bowing before authority, prostrate"},
        {"id": "dominant_stance", "name": "支配姿态", "prompt": "dominant stance, confident posture, arms crossed, commanding presence, authoritative"},
        {"id": "captured", "name": "俘虏", "prompt": "captured, prisoner, defeated, captured and restrained, held captive"},
        {"id": "bound_ropes", "name": "绳索捆绑", "prompt": "bound with ropes, rope bondage, tied securely, wrapped in ropes, shibari-style binding"},
        {"id": "tied_to_post", "name": "绑在柱子上", "prompt": "tied to post, restrained to pillar, bound upright, secured to structure"},
        {"id": "captive_pose", "name": "囚禁姿态", "prompt": "captive pose, imprisoned, confined, trapped in space, restricted freedom"},
        {"id": "master_servant", "name": "主仆关系", "prompt": "master and servant, hierarchical relationship, obedience, serving posture"},
        {"id": "guard_prisoner", "name": "看守与囚犯", "prompt": "guard and prisoner, incarceration, detention, captive and guard dynamic"},
        {"id": "teacher_disciple", "name": "师徒", "prompt": "teacher and disciple, mentor and student, learning hierarchy, teaching posture"},
        {"id": "queen_subject", "name": "女王与臣民", "prompt": "queen and subject, royal hierarchy, bowing before royalty, courtly submission"},
        {"id": "angel_demon", "name": "天使与恶魔", "prompt": "angel and demon, celestial vs infernal, light vs darkness, opposing forces"},
        {"id": "god_mortal", "name": "神与凡人", "prompt": "god and mortal, divine vs human, worshipping deity, mortal before god"},
        {"id": "alpha_beta", "name": "Alpha/Beta等级", "prompt": "alpha beta dynamic, hierarchy ranking, dominant alpha, subordinate beta, pack order"},
        {"id": "master_pet", "name": "主人宠物", "prompt": "master and pet, owner and pet dynamic, trained behavior, obedient pet"},
        {"id": "throne_sitting", "name": "王座", "prompt": "sitting on throne, elevated position, ruling posture, commanding presence from seat"},
        {"id": "floor_position", "name": "地板位置", "prompt": "on the floor, low position, ground level, submissive floor placement"},
        {"id": "elevated_dominant", "name": "高位支配", "prompt": "elevated position, standing tall,居高临下, dominant height advantage"},
        {"id": "restrained_seated", "name": "束缚坐姿", "prompt": "restrained seated, tied while sitting, bound posture, confined sitting position"},
        {"id": "forced_kneeling", "name": "被迫跪下", "prompt": "forced kneeling, compelled to kneel, made to bow, unwilling submission"},
        {"id": "head_petting", "name": "摸头", "prompt": "head patting, being petted, head scratch, affectionate dominance, praised gesture"},
        {"id": "chin_lift", "name": "抬下巴", "prompt": "chin lifted, face turned up, forced eye contact, chin grab, examining"},
        {"id": "collar_grab", "name": "抓项圈", "prompt": "grabbing collar, pulling by collar, collar control, leash handling, dominant grip"},
        {"id": "hair_pull", "name": "拽头发", "prompt": "hair pulled, yanking hair, forcing head back, hair grip, pulling by locks"},
    ],
}


def load_nsfw():
    with open(NSFW_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_nsfw(data):
    with open(NSFW_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[OK] 已保存 {NSFW_FILE}")


def add_tags(data):
    """将新标签添加到 nsfw 主分类下对应的子分类"""
    nsfw_root = None
    for item in data:
        if isinstance(item, dict) and item.get("id") == "nsfw":
            nsfw_root = item
            break

    if not nsfw_root:
        print("[ERROR] 找不到 nsfw 根分类")
        return

    added_count = 0
    for cat_id, tags in NEW_TAGS.items():
        # 查找或创建子分类
        target_cat = None
        for child in nsfw_root.get("children", []):
            if isinstance(child, dict) and child.get("id") == cat_id:
                target_cat = child
                break

        if not target_cat:
            # 创建新子分类
            names = {
                "psychological": "心理压迫",
                "extreme_environment": "极端环境",
                "physical_limit": "身体极限",
                "power_dynamics": "权力关系",
            }
            target_cat = {
                "id": cat_id,
                "name": names.get(cat_id, cat_id),
                "children": []
            }
            nsfw_root["children"].append(target_cat)
            print(f"[NEW] 新增子分类: {cat_id} ({names.get(cat_id, '')})")

        # 添加标签
        for tag in tags:
            # 检查是否已存在
            exists = False
            for existing in target_cat.get("children", []):
                if isinstance(existing, dict) and existing.get("id") == tag["id"]:
                    exists = True
                    break
            if not exists:
                target_cat.setdefault("children", []).append(tag)
                added_count += 1
                print(f"  + {tag['id']}: {tag['name']}")
            else:
                print(f"  - {tag['id']}: 已存在，跳过")

    return added_count


def main():
    print(f"加载: {NSFW_FILE}")
    data = load_nsfw()

    print(f"\n开始添加标签...")
    added = add_tags(data)

    print(f"\n共新增 {added} 个标签")
    save_nsfw(data)

    # 统计
    def count_tags(obj):
        c = 0
        if isinstance(obj, list):
            for item in obj:
                c += count_tags(item)
        elif isinstance(obj, dict):
            if 'id' in obj and 'prompt' in obj:
                c += 1
            for v in obj.values():
                c += count_tags(v)
        return c

    total = count_tags(data)
    print(f"NSFW 总标签数: {total}")


if __name__ == "__main__":
    main()
