"""
NeuroRelief AI — Pain Severity Prediction Model
================================================
Dataset: IEEE DataPort - Menstrual Cycle Phase Prediction and Hygiene Guidance
Source: https://ieee-dataport.org/documents/dataset-menstrual-cycle-phase-prediction-and-hygiene-guidance
Individuals: 42 | Records: 2,937 | Features used: 12 | Target: pain_nrs

Models trained:
  1. Random Forest Classifier — robust, interpretable, feature importances
  2. Gradient Boosting Classifier — stronger accuracy, ensemble comparison

Output:
  - Classification report (precision, recall, F1 per class)
  - Confusion matrix
  - Feature importance chart
  - Saved model (.pkl) for backend integration
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import LabelEncoder, OrdinalEncoder
from sklearn.metrics import (classification_report, confusion_matrix, 
                             accuracy_score, f1_score, ConfusionMatrixDisplay)
import pickle
import warnings
warnings.filterwarnings('ignore')

# ─────────────────────────────────────────────────
# 1. LOAD DATA
# ─────────────────────────────────────────────────
print("=" * 60)
print("NeuroRelief AI — Pain Severity Prediction Model")
print("=" * 60)

df = pd.read_csv('cleaned_dataset__1_.csv')
print(f"\nDataset loaded: {df.shape[0]} rows, {df.shape[1]} columns")
print(f"Unique individuals: {df['id'].nunique()}")

# ─────────────────────────────────────────────────
# 2. PREPROCESSING
# ─────────────────────────────────────────────────
print("\n--- Preprocessing ---")

# Remove outlier (pain_nrs = 33, clearly a data error)
df = df[df['pain_nrs'] <= 10].copy()
print(f"After removing outliers: {df.shape[0]} rows")

# Create pain severity categories for classification
# Low (0-3), Moderate (4-6), High (7-10)
def categorize_pain(score):
    if score <= 3:
        return 'Low'
    elif score <= 6:
        return 'Moderate'
    else:
        return 'High'

df['pain_category'] = df['pain_nrs'].apply(categorize_pain)
print(f"\nPain category distribution:")
print(df['pain_category'].value_counts().to_string())

# Encode ordinal symptom columns (Not at all < Very Low < Low < Moderate < High < Very High)
ordinal_order = ['Not at all', 'Very Low/Little', 'Low', 'Moderate', 'High', 'Very High']
ordinal_cols = ['fatigue', 'cramps', 'headaches', 'stress', 'bloating', 
                'moodswing', 'sleepissue', 'foodcravings', 'indigestion']

ordinal_enc = OrdinalEncoder(categories=[ordinal_order] * len(ordinal_cols), 
                              handle_unknown='use_encoded_value', unknown_value=-1)
df[ordinal_cols] = ordinal_enc.fit_transform(df[ordinal_cols])

# Encode cycle phase
phase_map = {'Menstrual': 0, 'Follicular': 1, 'Fertility': 2, 'Luteal': 3}
df['phase_encoded'] = df['phase'].map(phase_map)

# Encode activity level
activity_map = {'Low': 0, 'Moderate': 1}
df['activity_encoded'] = df['activity_level'].map(activity_map)

# Encode mood
mood_map = {'sad': 0, 'Moody': 1, 'Calm': 2, 'Energetic': 3}
df['mood_encoded'] = df['mood'].map(mood_map).fillna(1)

# Encode target
label_enc = LabelEncoder()
df['pain_label'] = label_enc.fit_transform(df['pain_category'])
# Save class names for later
class_names = label_enc.classes_
print(f"Class encoding: {dict(zip(class_names, label_enc.transform(class_names)))}")

# ─────────────────────────────────────────────────
# 3. FEATURE SELECTION
# ─────────────────────────────────────────────────
# Features selected based on literature review (Chapter 2 of report):
# - Cycle phase affects pain due to prostaglandin release
# - Sleep quality/duration affects pain perception
# - Stress level correlates with pain intensity
# - Physical activity provides natural pain relief
# - BMI and age are demographic confounders
# - Symptoms (cramps, fatigue, headaches) co-occur with pain

feature_cols = [
    'phase_encoded',        # Cycle phase (menstrual/follicular/fertility/luteal)
    'day_from_last_menses', # Day in cycle
    'sleep_hours',          # Sleep duration
    'stress',               # Stress level (ordinal encoded)
    'fatigue',              # Fatigue level
    'cramps',               # Cramps severity
    'headaches',            # Headache severity
    'bloating',             # Bloating severity
    'moodswing',            # Mood swing severity
    'sleepissue',           # Sleep issues
    'activity_encoded',     # Physical activity level
    'mood_encoded',         # Current mood
    'BMI',                  # Body mass index
    'age',                  # Age
]

X = df[feature_cols].copy()
y = df['pain_label'].copy()

# Handle any remaining NaN
X = X.fillna(X.median())

print(f"\nFeatures: {len(feature_cols)}")
print(f"Samples: {len(X)}")

# ─────────────────────────────────────────────────
# 4. TRAIN-TEST SPLIT
# ─────────────────────────────────────────────────
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)
print(f"\nTrain: {len(X_train)} | Test: {len(X_test)}")

# ─────────────────────────────────────────────────
# 5. MODEL 1: RANDOM FOREST
# ─────────────────────────────────────────────────
print("\n" + "=" * 60)
print("MODEL 1: Random Forest Classifier")
print("=" * 60)

rf_model = RandomForestClassifier(
    n_estimators=200,
    max_depth=12,
    min_samples_split=5,
    min_samples_leaf=3,
    class_weight='balanced',  # Handle class imbalance
    random_state=42,
    n_jobs=-1
)
rf_model.fit(X_train, y_train)
rf_pred = rf_model.predict(X_test)

rf_acc = accuracy_score(y_test, rf_pred)
rf_f1 = f1_score(y_test, rf_pred, average='weighted')

print(f"\nAccuracy: {rf_acc:.4f}")
print(f"Weighted F1: {rf_f1:.4f}")
print(f"\nClassification Report:")
print(classification_report(y_test, rf_pred, target_names=class_names))

# Cross-validation
rf_cv = cross_val_score(rf_model, X, y, cv=5, scoring='f1_weighted')
print(f"5-Fold CV F1 (mean ± std): {rf_cv.mean():.4f} ± {rf_cv.std():.4f}")

# ─────────────────────────────────────────────────
# 6. MODEL 2: GRADIENT BOOSTING
# ─────────────────────────────────────────────────
print("\n" + "=" * 60)
print("MODEL 2: Gradient Boosting Classifier")
print("=" * 60)

gb_model = GradientBoostingClassifier(
    n_estimators=200,
    max_depth=5,
    learning_rate=0.1,
    min_samples_split=5,
    random_state=42
)
gb_model.fit(X_train, y_train)
gb_pred = gb_model.predict(X_test)

gb_acc = accuracy_score(y_test, gb_pred)
gb_f1 = f1_score(y_test, gb_pred, average='weighted')

print(f"\nAccuracy: {gb_acc:.4f}")
print(f"Weighted F1: {gb_f1:.4f}")
print(f"\nClassification Report:")
print(classification_report(y_test, gb_pred, target_names=class_names))

gb_cv = cross_val_score(gb_model, X, y, cv=5, scoring='f1_weighted')
print(f"5-Fold CV F1 (mean ± std): {gb_cv.mean():.4f} ± {gb_cv.std():.4f}")

# ─────────────────────────────────────────────────
# 7. MODEL COMPARISON
# ─────────────────────────────────────────────────
print("\n" + "=" * 60)
print("MODEL COMPARISON")
print("=" * 60)
print(f"{'Model':<25} {'Accuracy':<12} {'F1 (weighted)':<15} {'CV F1':<15}")
print(f"{'Random Forest':<25} {rf_acc:<12.4f} {rf_f1:<15.4f} {rf_cv.mean():<15.4f}")
print(f"{'Gradient Boosting':<25} {gb_acc:<12.4f} {gb_f1:<15.4f} {gb_cv.mean():<15.4f}")

best_model = rf_model if rf_f1 >= gb_f1 else gb_model
best_name = "Random Forest" if rf_f1 >= gb_f1 else "Gradient Boosting"
best_pred = rf_pred if rf_f1 >= gb_f1 else gb_pred
print(f"\nBest model: {best_name}")

# ─────────────────────────────────────────────────
# 8. VISUALIZATIONS
# ─────────────────────────────────────────────────
fig, axes = plt.subplots(2, 2, figsize=(14, 11))
fig.suptitle('NeuroRelief AI — Pain Severity Prediction Results', fontsize=16, fontweight='bold')

# 8a. Confusion Matrix - Random Forest
cm_rf = confusion_matrix(y_test, rf_pred)
sns.heatmap(cm_rf, annot=True, fmt='d', cmap='RdPu', xticklabels=class_names, 
            yticklabels=class_names, ax=axes[0, 0])
axes[0, 0].set_title('Random Forest — Confusion Matrix')
axes[0, 0].set_ylabel('Actual')
axes[0, 0].set_xlabel('Predicted')

# 8b. Confusion Matrix - Gradient Boosting
cm_gb = confusion_matrix(y_test, gb_pred)
sns.heatmap(cm_gb, annot=True, fmt='d', cmap='RdPu', xticklabels=class_names, 
            yticklabels=class_names, ax=axes[0, 1])
axes[0, 1].set_title('Gradient Boosting — Confusion Matrix')
axes[0, 1].set_ylabel('Actual')
axes[0, 1].set_xlabel('Predicted')

# 8c. Feature Importance (Random Forest)
importances = rf_model.feature_importances_
feat_imp = pd.Series(importances, index=feature_cols).sort_values(ascending=True)
feat_imp.plot(kind='barh', ax=axes[1, 0], color='#DB2777')
axes[1, 0].set_title('Random Forest — Feature Importance')
axes[1, 0].set_xlabel('Importance')

# 8d. Model Comparison Bar Chart
models = ['Random Forest', 'Gradient Boosting']
accuracies = [rf_acc, gb_acc]
f1_scores = [rf_f1, gb_f1]
x = np.arange(len(models))
width = 0.3
axes[1, 1].bar(x - width/2, accuracies, width, label='Accuracy', color='#DB2777')
axes[1, 1].bar(x + width/2, f1_scores, width, label='F1 Score', color='#7C3AED')
axes[1, 1].set_title('Model Comparison')
axes[1, 1].set_xticks(x)
axes[1, 1].set_xticklabels(models)
axes[1, 1].set_ylim(0, 1.1)
axes[1, 1].legend()
for i, (a, f) in enumerate(zip(accuracies, f1_scores)):
    axes[1, 1].text(i - width/2, a + 0.02, f'{a:.2f}', ha='center', fontsize=10)
    axes[1, 1].text(i + width/2, f + 0.02, f'{f:.2f}', ha='center', fontsize=10)

plt.tight_layout()
plt.savefig('ml_results.png', dpi=150, bbox_inches='tight')
print("\nResults chart saved: ml_results.png")

# ─────────────────────────────────────────────────
# 9. PAIN DISTRIBUTION BY PHASE
# ─────────────────────────────────────────────────
fig2, axes2 = plt.subplots(1, 2, figsize=(14, 5))
fig2.suptitle('NeuroRelief AI — Pain Analysis by Cycle Phase', fontsize=14, fontweight='bold')

# Pain score distribution by phase
phase_names = {0: 'Menstrual', 1: 'Follicular', 2: 'Fertility', 3: 'Luteal'}
df['phase_name'] = df['phase_encoded'].map(phase_names)
df.boxplot(column='pain_nrs', by='phase_name', ax=axes2[0])
axes2[0].set_title('Pain Score by Cycle Phase')
axes2[0].set_xlabel('Phase')
axes2[0].set_ylabel('Pain Score (NRS)')
plt.sca(axes2[0])
plt.xticks(rotation=45)

# Pain category distribution
df['pain_category'].value_counts().plot(kind='pie', ax=axes2[1], 
    colors=['#10B981', '#F59E0B', '#EF4444'], autopct='%1.1f%%')
axes2[1].set_title('Pain Severity Distribution')
axes2[1].set_ylabel('')

plt.tight_layout()
plt.savefig('pain_analysis.png', dpi=150, bbox_inches='tight')
print("Pain analysis chart saved: pain_analysis.png")

# ─────────────────────────────────────────────────
# 10. SAVE MODEL FOR BACKEND
# ─────────────────────────────────────────────────
model_data = {
    'model': best_model,
    'feature_cols': feature_cols,
    'label_encoder': label_enc,
    'ordinal_encoder': ordinal_enc,
    'ordinal_cols': ordinal_cols,
    'class_names': list(class_names),
    'phase_map': phase_map,
    'activity_map': activity_map,
    'mood_map': mood_map,
    'accuracy': max(rf_acc, gb_acc),
    'f1_score': max(rf_f1, gb_f1),
}

with open('neurorelief_model.pkl', 'wb') as f:
    pickle.dump(model_data, f)
print(f"\nModel saved: neurorelief_model.pkl")
print(f"Ready for backend integration via: pickle.load(open('neurorelief_model.pkl', 'rb'))")

# ─────────────────────────────────────────────────
# 11. EXAMPLE PREDICTION
# ─────────────────────────────────────────────────
print("\n" + "=" * 60)
print("EXAMPLE PREDICTION")
print("=" * 60)
example = pd.DataFrame([{
    'phase_encoded': 0,          # Menstrual phase
    'day_from_last_menses': 2,   # Day 2 of cycle
    'sleep_hours': 5.0,          # Poor sleep
    'stress': 4,                 # High stress
    'fatigue': 4,                # High fatigue
    'cramps': 4,                 # High cramps
    'headaches': 3,              # Moderate headache
    'bloating': 3,               # Moderate bloating
    'moodswing': 3,              # Moderate mood swings
    'sleepissue': 4,             # High sleep issues
    'activity_encoded': 0,       # Low activity
    'mood_encoded': 0,           # Sad mood
    'BMI': 24.5,
    'age': 25,
}])

pred_class = best_model.predict(example)[0]
pred_proba = best_model.predict_proba(example)[0]
print(f"Input: Menstrual phase, Day 2, Poor sleep, High stress")
print(f"Predicted pain: {class_names[pred_class]}")
print(f"Probabilities: {dict(zip(class_names, [f'{p:.2f}' for p in pred_proba]))}")

print("\n" + "=" * 60)
print("DONE — All outputs saved")
print("=" * 60)