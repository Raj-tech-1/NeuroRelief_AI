import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../i18n/format'
import EnglishOnly from '../../components/EnglishOnly'
import { getArticles } from '../../services/api'

const categories = [
  { id: 'all', emoji: '📚' },
  { id: 'menstrual health', emoji: '⚙️' },
  { id: 'nutrition', emoji: '🥗' },
  { id: 'mental health', emoji: '🧠' },
  { id: 'fitness', emoji: '💪' },
  { id: 'sexual health', emoji: '💕' },
]

const levelColors = {
  beginner: 'bg-green-100 text-green-700',
  intermediate: 'bg-orange-100 text-orange-700',
  advanced: 'bg-red-100 text-red-700',
}

const catBadgeColors = {
  'menstrual health': 'bg-pink-100 text-pink-700',
  'nutrition': 'bg-green-100 text-green-700',
  'mental health': 'bg-purple-100 text-purple-700',
  'fitness': 'bg-blue-100 text-blue-700',
  'sexual health': 'bg-pink-100 text-pink-700',
}

// Full article content for each article
const articleContent = {
  1: {
    sections: [
      { heading: 'The Four Phases', body: 'Your menstrual cycle has four distinct phases: menstrual, follicular, ovulatory, and luteal. Each phase is driven by different hormones and affects your body and mood in unique ways.' },
      { heading: 'Menstrual Phase (Days 1-5)', body: 'This is when your period occurs. Hormone levels (estrogen and progesterone) are at their lowest. You may experience cramps, fatigue, and lower energy. Focus on rest, gentle movement, and iron-rich foods.' },
      { heading: 'Follicular Phase (Days 6-13)', body: 'Estrogen rises as your body prepares for ovulation. Energy increases, mood improves, and creativity peaks. This is a great time for starting new projects and higher-intensity exercise.' },
      { heading: 'Ovulatory Phase (Days 14-16)', body: 'A surge in luteinizing hormone triggers ovulation. You may feel most confident and social. Skin tends to look its best. Energy is at its peak.' },
      { heading: 'Luteal Phase (Days 17-28)', body: 'Progesterone rises and then falls. PMS symptoms may appear in the later days — bloating, mood changes, cravings. Focus on self-care, complex carbs, and stress management.' },
    ]
  },
  2: {
    sections: [
      { heading: 'Why Nutrition Matters', body: 'What you eat directly impacts your hormonal balance. Certain nutrients support hormone production, reduce inflammation, and ease common menstrual symptoms.' },
      { heading: 'Iron-Rich Foods', body: 'During menstruation, iron loss through blood can lead to fatigue. Include spinach, lentils, red meat, and fortified cereals. Pair with vitamin C for better absorption.' },
      { heading: 'Omega-3 Fatty Acids', body: 'Found in salmon, walnuts, and flaxseeds, omega-3s reduce inflammation and can lessen period pain intensity. Aim for 2-3 servings of fatty fish per week.' },
      { heading: 'Magnesium', body: 'Magnesium helps with cramps, sleep, and mood. Dark chocolate, almonds, avocados, and bananas are excellent sources. Consider supplementing if deficient.' },
      { heading: 'Foods to Limit', body: 'Excess caffeine, alcohol, refined sugar, and high-sodium processed foods can worsen bloating, anxiety, and cramps. Moderation is key, especially during the luteal phase.' },
    ]
  },
  3: {
    sections: [
      { heading: 'Understanding PMS', body: 'Premenstrual syndrome affects up to 75% of menstruating women. Symptoms typically appear 1-2 weeks before your period and include mood swings, bloating, fatigue, and irritability.' },
      { heading: 'Herbal Remedies', body: 'Chamomile tea reduces inflammation and promotes relaxation. Ginger tea can ease nausea and cramps. Chasteberry (Vitex) has been shown to reduce PMS symptoms in some studies.' },
      { heading: 'Exercise', body: 'Regular moderate exercise (30 minutes most days) releases endorphins that naturally combat pain and mood issues. Yoga and swimming are particularly beneficial during PMS.' },
      { heading: 'Stress Management', body: 'Stress worsens PMS symptoms. Try mindfulness meditation, deep breathing exercises, or journaling. Even 10 minutes daily can make a difference.' },
      { heading: 'Sleep Hygiene', body: 'Quality sleep is essential for hormone regulation. Keep a consistent sleep schedule, avoid screens before bed, and keep your bedroom cool and dark.' },
    ]
  },
  4: {
    sections: [
      { heading: 'Cycle-Synced Exercise', body: 'Your body responds differently to exercise throughout your cycle. Matching your workout intensity to your cycle phase can improve performance and reduce injury risk.' },
      { heading: 'Menstrual Phase', body: 'Low energy calls for gentle movement — walking, light yoga, stretching. Listen to your body and rest if needed. This is not the time for personal bests.' },
      { heading: 'Follicular Phase', body: 'Rising estrogen boosts energy and muscle recovery. Try HIIT workouts, strength training, or learning new skills. Your body handles high-intensity work better now.' },
      { heading: 'Ovulatory Phase', body: 'Peak performance window. Go for challenging workouts — heavy lifting, sprints, competitive sports. Testosterone peaks alongside estrogen.' },
      { heading: 'Luteal Phase', body: 'Energy gradually decreases. Moderate steady-state cardio, pilates, and moderate strength training work well. Avoid overtraining as recovery slows.' },
    ]
  },
  5: {
    sections: [
      { heading: 'What is PCOS?', body: 'Polycystic Ovary Syndrome is a hormonal disorder affecting 1 in 10 women. It involves excess androgen production, irregular periods, and often small cysts on the ovaries.' },
      { heading: 'Common Symptoms', body: 'Irregular or absent periods, excess hair growth, acne, weight gain (especially around the abdomen), thinning hair, and difficulty conceiving are common signs.' },
      { heading: 'Diagnosis', body: 'PCOS is diagnosed based on at least two of three criteria: irregular ovulation, elevated androgen levels, and polycystic ovaries on ultrasound. Blood tests check hormone levels.' },
      { heading: 'Management Strategies', body: 'Lifestyle changes are first-line treatment: regular exercise, balanced diet low in refined carbs, stress management, and adequate sleep. Weight loss of even 5-10% can restore ovulation.' },
      { heading: 'Medical Treatment', body: 'Doctors may prescribe hormonal birth control to regulate cycles, metformin for insulin resistance, or fertility medications when trying to conceive. Treatment is personalized.' },
    ]
  },
  6: {
    sections: [
      { heading: 'The Sleep-Cycle Connection', body: 'Hormonal fluctuations throughout your menstrual cycle directly affect sleep quality. Understanding this connection helps you adapt your routine for better rest.' },
      { heading: 'Follicular Phase Sleep', body: 'Rising estrogen generally promotes better sleep. You may fall asleep more easily and feel more rested. Take advantage of this for consistent sleep scheduling.' },
      { heading: 'Luteal Phase Disruption', body: 'Progesterone raises body temperature, which can disrupt sleep. Many women report insomnia and restless nights in the week before their period. Keep your bedroom extra cool.' },
      { heading: 'During Your Period', body: 'Pain and discomfort can interrupt sleep. Use a warm compress, comfortable positioning, and consider magnesium supplementation to improve sleep quality.' },
      { heading: 'Sleep Optimization Tips', body: 'Maintain a consistent wake time (even on weekends), limit caffeine after noon, use blackout curtains, and try a relaxation routine before bed. Track your sleep alongside your cycle to identify patterns.' },
    ]
  },
  7: {
    sections: [
      { heading: 'What is TENS?', body: 'Transcutaneous Electrical Nerve Stimulation (TENS) is a non-invasive pain relief method that uses low-voltage electrical currents delivered through electrode pads placed on the skin. It is drug-free, adjustable, and widely used for menstrual cramp relief.' },
      { heading: 'How It Works', body: 'TENS works through the Gate Control Theory of pain. Electrical pulses stimulate large-diameter A-beta nerve fibers, which inhibit pain signals carried by smaller C-fibers at the spinal cord level. This effectively closes the "pain gate" before signals reach the brain. Additionally, TENS may stimulate endorphin release.' },
      { heading: 'Optimal Settings', body: 'For menstrual pain, high-frequency TENS (50-150 Hz) with a pulse width of 100-200 microseconds is typically most effective. Intensity should be strong but comfortable — never painful. Electrode placement on the lower abdomen or lower back targets the uterine cramping directly.' },
      { heading: 'Clinical Evidence', body: 'Multiple clinical studies have shown TENS to be effective for primary dysmenorrhea, with pain reduction comparable to NSAIDs in some trials. The advantage is zero gastrointestinal side effects and the ability to use it continuously throughout the day.' },
      { heading: 'Safety Considerations', body: 'TENS should not be used during pregnancy, over the heart area, or by individuals with pacemakers. Always start at the lowest intensity and increase gradually. If skin irritation occurs, change electrode pad positions.' },
    ]
  },
  8: {
    sections: [
      { heading: 'Why Heat Works', body: 'Heat therapy increases blood flow to the abdominal and pelvic muscles, counteracting the ischemia (reduced blood supply) caused by strong uterine contractions during menstruation. It also relaxes smooth muscle tissue, directly reducing cramping intensity.' },
      { heading: 'Optimal Temperature', body: 'The therapeutic range is 38-42°C (100-108°F). Below 38°C provides insufficient vasodilation, while above 42°C risks skin burns. Continuous low-level heat at 40°C has been shown to provide optimal pain relief for most women.' },
      { heading: 'Heat vs. Medication', body: 'Studies have found that continuous low-level topical heat provides pain relief comparable to ibuprofen (400mg) for primary dysmenorrhea, with the significant advantage of having no pharmacological side effects and no risk of gastrointestinal complications.' },
      { heading: 'Application Methods', body: 'Options include adhesive heat wraps (last 8-12 hours), electric heating pads (adjustable temperature), hot water bottles (traditional), and smart wearable devices with PID-controlled heating elements that maintain precise temperatures.' },
      { heading: 'Combining with TENS', body: 'Heat and TENS work through different physiological mechanisms (vasodilation vs. nerve gate control), making them complementary. Using both simultaneously can provide superior pain relief compared to either modality alone.' },
    ]
  },
  9: {
    sections: [
      { heading: 'Inflammation and Pain', body: 'Menstrual pain is driven by prostaglandins — inflammatory compounds released by the uterine lining. An anti-inflammatory diet can reduce prostaglandin production, directly lowering pain intensity over time.' },
      { heading: 'Omega-3 Rich Foods', body: 'Fatty fish (salmon, mackerel, sardines), walnuts, flaxseeds, and chia seeds are rich in omega-3 fatty acids, which compete with omega-6s for enzyme access, reducing pro-inflammatory prostaglandin synthesis. Aim for 2-3 servings of fatty fish per week.' },
      { heading: 'Turmeric and Ginger', body: 'Curcumin (from turmeric) inhibits COX-2 enzymes similar to how NSAIDs work. Ginger has been shown in studies to be as effective as mefenamic acid for menstrual pain. Add these to meals, smoothies, or drink as teas.' },
      { heading: 'Foods to Avoid', body: 'Refined sugars, processed foods, excess red meat, and trans fats increase inflammation. Alcohol and caffeine can worsen cramps by increasing cortisol and reducing magnesium absorption. Reduce these especially in the luteal and menstrual phases.' },
      { heading: 'Meal Planning', body: 'Structure meals around leafy greens, whole grains, lean proteins, and colorful vegetables. Berries, dark chocolate (70%+), and green tea are excellent anti-inflammatory snacks. Consistency matters more than perfection.' },
    ]
  },
  10: {
    sections: [
      { heading: 'Why Periods Affect Iron', body: 'Average menstrual blood loss is 30-40ml per cycle, containing approximately 15-20mg of iron. Heavy periods (menorrhagia) can result in losses exceeding 80ml, significantly depleting iron stores over time.' },
      { heading: 'Symptoms of Deficiency', body: 'Fatigue, weakness, pale skin, shortness of breath, dizziness, cold hands and feet, brittle nails, and unusual cravings (pica) are common signs. Many women dismiss these as "normal tiredness" when they may indicate iron deficiency anemia.' },
      { heading: 'Iron-Rich Foods', body: 'Heme iron (most absorbable): red meat, liver, shellfish, sardines. Non-heme iron: spinach, lentils, chickpeas, tofu, fortified cereals, pumpkin seeds, quinoa. Pair with vitamin C (citrus, bell peppers) to boost absorption by up to 300%.' },
      { heading: 'Absorption Blockers', body: 'Calcium, tannins (tea/coffee), and phytates (whole grains) reduce iron absorption. Avoid drinking tea or coffee with iron-rich meals. Wait 1-2 hours between calcium supplements and iron-rich foods.' },
      { heading: 'When to Supplement', body: 'If dietary changes are insufficient, a doctor may recommend iron supplements. Ferrous sulfate is most common. Take on an empty stomach with vitamin C for best absorption. Side effects (constipation, nausea) can be managed by taking with food or switching forms.' },
    ]
  },
  11: {
    sections: [
      { heading: 'Why Yoga Helps', body: 'Yoga combines gentle stretching, controlled breathing, and mindfulness — all of which reduce cortisol, increase blood flow to the pelvic area, and activate the parasympathetic nervous system to reduce pain perception.' },
      { heading: 'Child\'s Pose (Balasana)', body: 'Kneel on the floor, sit back on heels, extend arms forward on the mat. Hold for 1-3 minutes. This gently compresses the abdomen, promoting blood flow and relieving lower back tension. The resting position also calms the nervous system.' },
      { heading: 'Cat-Cow Stretch', body: 'On hands and knees, alternate between arching your back (cow) and rounding it (cat). Repeat 10-15 times. This mobilizes the spine, stretches abdominal muscles, and gently massages the reproductive organs.' },
      { heading: 'Supine Twist', body: 'Lie on your back, bring one knee across your body while keeping shoulders flat. Hold each side 1-2 minutes. This stretch releases tension in the lower back and hips while gently stimulating abdominal organs.' },
      { heading: 'When to Practice', body: 'Best done during the menstrual phase (days 1-5) when cramps are strongest. Avoid inversions and intense core work during heavy flow days. Focus on restorative and yin-style poses. Even 10 minutes daily can significantly reduce pain.' },
    ]
  },
  12: {
    sections: [
      { heading: 'Hormones and Muscle', body: 'Estrogen promotes muscle repair and growth, peaking during the follicular and ovulatory phases. Progesterone in the luteal phase increases body temperature and can reduce exercise capacity. Testosterone, though lower in women, peaks at ovulation.' },
      { heading: 'Follicular Phase Training', body: 'Rising estrogen improves muscle protein synthesis and recovery. This is the optimal window for heavy lifts, progressive overload, and attempting personal records. Your body recovers faster and builds muscle more efficiently now.' },
      { heading: 'Ovulatory Phase', body: 'Peak strength potential due to combined estrogen and testosterone elevation. However, ACL injury risk also increases due to ligament laxity from estrogen. Focus on proper form and warm-up thoroughly before explosive movements.' },
      { heading: 'Luteal Phase Adjustments', body: 'Higher progesterone raises core temperature and metabolic rate. You may fatigue faster and recover slower. Reduce training volume by 10-20%, focus on moderate loads, and increase rest periods between sets.' },
      { heading: 'Long-Term Benefits', body: 'Consistent strength training improves insulin sensitivity, reduces PMS symptoms, strengthens bones (preventing osteoporosis), and increases baseline pain tolerance. Even 2-3 sessions per week produces measurable hormonal and physical benefits.' },
    ]
  },
  13: {
    sections: [
      { heading: 'The Progesterone Connection', body: 'Anxiety often peaks during the luteal phase (days 17-28) because progesterone, which initially has calming GABA-like effects, drops sharply in the final days before menstruation. This withdrawal effect can trigger anxiety similar to benzodiazepine withdrawal.' },
      { heading: 'Recognizing Cycle-Related Anxiety', body: 'Track anxiety alongside your cycle for 2-3 months. If anxiety consistently worsens in the 7-10 days before your period and improves within a few days of starting, it is likely hormone-related rather than a standalone anxiety disorder.' },
      { heading: 'Box Breathing Technique', body: 'Inhale for 4 counts, hold for 4 counts, exhale for 4 counts, hold for 4 counts. Repeat 4-6 times. This activates the vagus nerve and parasympathetic nervous system, reducing heart rate and cortisol within minutes.' },
      { heading: 'Lifestyle Modifications', body: 'Reduce caffeine (especially after noon), limit alcohol, prioritize 7-9 hours of sleep, and maintain regular exercise. Magnesium glycinate (200-400mg) before bed can help with both sleep and anxiety during the luteal phase.' },
      { heading: 'When to Seek Help', body: 'If anxiety significantly disrupts daily functioning, consider speaking with a healthcare provider. Premenstrual Dysphoric Disorder (PMDD) affects 3-8% of women and may require targeted treatment including SSRIs or hormonal interventions.' },
    ]
  },
  14: {
    sections: [
      { heading: 'What is Endometriosis?', body: 'Endometriosis occurs when tissue similar to the uterine lining grows outside the uterus — on ovaries, fallopian tubes, bowel, or pelvic lining. This tissue responds to hormonal changes, bleeding during menstruation but with no way to exit the body, causing inflammation and pain.' },
      { heading: 'Common Symptoms', body: 'Severe menstrual cramps (worse than typical period pain), chronic pelvic pain, pain during intercourse, painful bowel movements, heavy periods, fatigue, and difficulty conceiving. Symptoms vary widely — some women with extensive disease have minimal pain, while others with mild disease have severe symptoms.' },
      { heading: 'Diagnosis', body: 'Average diagnosis takes 7-10 years from symptom onset. Ultrasound can detect ovarian endometriomas (chocolate cysts) but not superficial implants. Definitive diagnosis requires laparoscopic surgery with biopsy. MRI is increasingly used for deep infiltrating endometriosis.' },
      { heading: 'Treatment Options', body: 'Pain management (NSAIDs, hormonal birth control), hormonal therapies (progestins, GnRH agonists), excision surgery to remove implants, and complementary approaches (physiotherapy, anti-inflammatory diet, acupuncture). Treatment is personalized based on symptom severity and fertility goals.' },
      { heading: 'Living with Endometriosis', body: 'Build a support network, track symptoms for healthcare appointments, advocate for yourself with doctors, consider pelvic floor physiotherapy, and explore anti-inflammatory dietary approaches. Support organizations and online communities provide valuable resources and connection.' },
    ]
  },
  15: {
    sections: [
      { heading: 'How Contraception Affects Cycles', body: 'Hormonal contraceptives work by suppressing ovulation, thinning the uterine lining, or thickening cervical mucus. Different methods affect your cycle differently — some eliminate periods entirely, others create regular withdrawal bleeds that mimic natural periods.' },
      { heading: 'Combined Pill', body: 'Contains synthetic estrogen and progestin. Suppresses ovulation and creates predictable 28-day cycles. The 7-day placebo week produces a withdrawal bleed, not a true period. Can reduce cramps and flow. Side effects may include mood changes, headaches, and breast tenderness.' },
      { heading: 'Hormonal IUD', body: 'Releases small amounts of progestin locally in the uterus. Thins the uterine lining significantly, often reducing or eliminating periods over time. Does not consistently suppress ovulation. Effective for 3-7 years depending on type. May initially cause irregular spotting.' },
      { heading: 'Non-Hormonal Options', body: 'Copper IUD provides contraception without hormones by creating an inhospitable environment for sperm. Does not change your natural cycle but may increase flow and cramping initially. Barrier methods (condoms, diaphragm) have zero hormonal effects.' },
      { heading: 'Coming Off Contraception', body: 'When stopping hormonal contraception, it may take 1-3 months for natural cycles to resume. Some women experience post-pill amenorrhea. Track your cycle from the first natural period to establish your personal pattern. Fertility typically returns quickly.' },
    ]
  },
  16: {
    sections: [
      { heading: 'Female Reproductive Anatomy', body: 'The reproductive system includes the ovaries (produce eggs and hormones), fallopian tubes (where fertilization occurs), uterus (where pregnancy develops), cervix (connects uterus to vagina), and vagina. Understanding anatomy helps you communicate effectively with healthcare providers.' },
      { heading: 'The Fertility Window', body: 'An egg lives 12-24 hours after ovulation, but sperm can survive 3-5 days in the reproductive tract. This creates a fertility window of approximately 6 days per cycle — the 5 days before ovulation plus ovulation day itself. Ovulation typically occurs around day 14 of a 28-day cycle.' },
      { heading: 'Cervical Mucus Changes', body: 'Cervical mucus changes throughout the cycle: dry after menstruation, sticky and white in the follicular phase, clear and stretchy (like egg whites) near ovulation, and thick and creamy in the luteal phase. Tracking these changes helps identify fertile days.' },
      { heading: 'Common Reproductive Concerns', body: 'Irregular periods, painful periods, heavy bleeding, vaginal infections, ovarian cysts, and fibroids are common. Most are treatable. Regular gynecological check-ups (annually from age 21 or when sexually active) help catch issues early.' },
      { heading: 'Maintaining Reproductive Health', body: 'Practice safe sex, maintain a balanced diet, exercise regularly, manage stress, avoid smoking, limit alcohol, stay hydrated, and get regular check-ups. Pelvic floor exercises (Kegels) support reproductive organ health long-term.' },
    ]
  },
  17: {
    sections: [
      { heading: 'The Estrobolome', body: 'Your gut contains a collection of bacteria called the estrobolome that produces an enzyme (beta-glucuronidase) which influences estrogen metabolism. An imbalanced gut can lead to estrogen dominance or deficiency, both of which affect menstrual health.' },
      { heading: 'Gut Dysbiosis and Periods', body: 'Antibiotic use, poor diet, chronic stress, and inadequate fiber disrupt gut bacteria balance. This can increase circulating estrogen levels, potentially worsening PMS, heavy periods, and conditions like endometriosis and PCOS.' },
      { heading: 'Probiotics and Hormones', body: 'Lactobacillus and Bifidobacterium strains support healthy estrogen metabolism. Fermented foods (yogurt, kefir, sauerkraut, kimchi, miso) naturally provide these beneficial bacteria. Probiotic supplements may help, but food sources are generally preferable.' },
      { heading: 'Fiber and Estrogen', body: 'Dietary fiber binds to excess estrogen in the intestines and removes it through bowel movements. Women who eat more fiber tend to have lower circulating estrogen and fewer PMS symptoms. Aim for 25-30g of fiber daily from vegetables, legumes, and whole grains.' },
      { heading: 'Practical Steps', body: 'Eat 30 different plant foods per week (diversity feeds diverse bacteria). Include prebiotic foods (garlic, onions, leeks, asparagus, bananas). Reduce processed foods and added sugars. Consider a soil-based probiotic if digestive issues persist. Gut health improvements may take 2-3 months to affect menstrual symptoms.' },
    ]
  },
  18: {
    sections: [
      { heading: 'Pain and the Brain', body: 'Pain is not just a physical signal — it is processed and amplified by the brain. Stress, anxiety, and negative expectations increase pain perception by activating the amygdala and reducing the brain\'s natural pain-modulation systems. Meditation directly targets this amplification.' },
      { heading: 'Body Scan Meditation', body: 'Lie down comfortably. Starting from your toes, slowly bring attention to each body part, noticing sensations without judgment. When you reach the painful area, breathe into it — observe the sensation as "pressure" or "warmth" rather than labeling it "pain." Practice for 10-20 minutes.' },
      { heading: 'Breath-Focused Meditation', body: 'Sit comfortably, close your eyes, and focus on natural breathing. Count breaths from 1 to 10, then restart. When your mind wanders to pain, gently return to counting. This trains the prefrontal cortex to regulate pain signals from the thalamus.' },
      { heading: 'Research Evidence', body: 'Mindfulness meditation has been shown to reduce pain intensity by 27-40% and pain unpleasantness by 44-57% in clinical studies. Regular practitioners (8+ weeks) show measurable changes in brain regions associated with pain processing, including increased gray matter in the anterior cingulate cortex.' },
      { heading: 'Building a Practice', body: 'Start with 5 minutes daily and increase gradually. Use guided meditation apps if helpful. Practice during low-pain days so the skill is available during high-pain days. Consistency matters more than session length — even brief daily practice produces measurable benefits within 4-8 weeks.' },
    ]
  },
}

export default function Learn() {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [articles, setArticles] = useState([])
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [openArticle, setOpenArticle] = useState(null)

  useEffect(() => { getArticles().then(setArticles) }, [])

  // titles/descriptions are shown in the selected language (articles.<id>.*); the English text stays as the fallback
  const tTitle = a => t(`articles.${a.id}.title`, { defaultValue: a.title })
  const tDesc = a => t(`articles.${a.id}.description`, { defaultValue: a.description })
  const tCat = c => t(`category.${c}`, { defaultValue: c })
  const tLevel = l => t(`level.${l}`, { defaultValue: l })

  const filtered = articles.filter(a => {
    const matchCat = activeCategory === 'all' || a.category === activeCategory
    const q = search.toLowerCase()
    // search matches both the displayed (translated) text and the original English text
    const matchSearch = !search || [a.title, a.description, tTitle(a), tDesc(a)].some(x => x.toLowerCase().includes(q))
    return matchCat && matchSearch
  })

  // Article detail view
  if (openArticle) {
    const article = articles.find(a => a.id === openArticle)
    const content = articleContent[openArticle]
    return (
      <div className="glass-card p-6">
        <button onClick={() => setOpenArticle(null)} className="text-brand-600 text-sm font-medium mb-4 hover:text-brand-800">{t('learn.back')}</button>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-xl font-bold text-brand-800">{article && tTitle(article)}</h3>
          <span className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium ${catBadgeColors[article?.category] || 'bg-gray-100 text-gray-600'}`}>
            {article && tCat(article.category)}
          </span>
        </div>
        <div className="flex items-center gap-3 mb-6">
          <span className="text-xs text-gray-400">{t('learn.readMinLong', { n: fmt.number(article?.readTime) })}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${levelColors[article?.level]}`}>{article && tLevel(article.level)}</span>
        </div>
        <p className="text-gray-600 mb-6">{article && tDesc(article)}</p>
        {content && (
          <p className="mb-5 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
            {t('learn.bodyNote')}<EnglishOnly />
          </p>
        )}
        {content?.sections.map((section, i) => (
          <div key={i} className="mb-5" lang="en">
            <h4 className="font-semibold text-gray-900 mb-2">{section.heading}</h4>
            <p className="text-sm text-gray-600 leading-relaxed">{section.body}</p>
          </div>
        ))}
        <div className="mt-6 pt-4 border-t border-gray-100">
          <button onClick={() => setOpenArticle(null)} className="px-6 py-2 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600">{t('learn.backBtn')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-bold text-brand-800 mb-1">{t('learn.title')}</h3>
      <p className="text-sm text-gray-500 mb-4">{t('learn.subtitle')}</p>

      <input
        type="text"
        placeholder={t('learn.searchPh')}
        aria-label={t('learn.searchPh')}
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl mb-4 text-sm focus:outline-none focus:border-brand-400"
      />

      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            aria-pressed={activeCategory === cat.id}
            className={`flex items-center gap-1 px-4 py-2 rounded-full text-sm font-medium transition ${
              activeCategory === cat.id ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span>{cat.emoji}</span> {tCat(cat.id)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map(article => (
          <div key={article.id} className="border border-gray-100 rounded-xl p-4 hover:bg-gray-50 transition">
            <div className="flex flex-wrap justify-between items-start gap-3">
              <div className="flex-1 basis-48 min-w-0">
                <h4 className="font-bold text-brand-800">{tTitle(article)}</h4>
                <p className="text-sm text-gray-500 mt-1">{tDesc(article)}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-gray-400">{t('learn.readMin', { n: fmt.number(article.readTime) })}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${levelColors[article.level]}`}>{tLevel(article.level)}</span>
                </div>
              </div>
              <span className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium ${catBadgeColors[article.category] || 'bg-gray-100 text-gray-600'}`}>
                {tCat(article.category)}
              </span>
            </div>
            <div className="text-right mt-2">
              <button onClick={() => setOpenArticle(article.id)} className="text-sm text-brand-600 font-medium hover:text-brand-800">{t('learn.readMore')}</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center text-gray-400 py-8">{t('learn.none')}</p>}
      </div>
    </div>
  )
}
