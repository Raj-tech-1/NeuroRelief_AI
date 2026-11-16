"""
Prediction script — reads input from a JSON file passed as argument.
Usage: python predict.py input_file.json
  {"features": {...}, "model_path": ...}  -> one prediction with an explanation
  {"rows": [{...}, ...], "model_path": ...} -> {"results": [...]} (batch, e.g. the 7-day forecast; no explanation)
"""
import sys
import json
import pickle
import pandas as pd


def build_row(input_data, model_data):
    return {
        'phase_encoded': model_data['phase_map'].get(input_data.get('phase', 'Follicular'), 1),
        'day_from_last_menses': input_data.get('day_from_last_menses', 14),
        'sleep_hours': input_data.get('sleep_hours', 7),
        'stress': input_data.get('stress', 3),
        'fatigue': input_data.get('fatigue', 2),
        'cramps': input_data.get('cramps', 2),
        'headaches': input_data.get('headaches', 1),
        'bloating': input_data.get('bloating', 1),
        'moodswing': input_data.get('moodswing', 1),
        'sleepissue': input_data.get('sleepissue', 1),
        'activity_encoded': model_data['activity_map'].get(input_data.get('activity_level', 'Moderate'), 1),
        'mood_encoded': model_data['mood_map'].get(input_data.get('mood', 'Calm'), 2),
        'BMI': input_data.get('bmi', 22),
        'age': input_data.get('age', 25),
    }


def main():
    input_file = sys.argv[1]

    with open(input_file, 'r') as f:
        data = json.load(f)

    with open(data['model_path'], 'rb') as f:
        model_data = pickle.load(f)

    model = model_data['model']
    class_names = model_data['class_names']

    if 'rows' in data:
        features = pd.DataFrame([build_row(r, model_data) for r in data['rows']])
        classes = model.predict(features)
        probas = model.predict_proba(features)
        print(json.dumps({'results': [result_for(class_names, c, p) for c, p in zip(classes, probas)]}))
        return

    features = pd.DataFrame([build_row(data['features'], model_data)])
    pred_class = model.predict(features)[0]
    pred_proba = model.predict_proba(features)[0]
    result = result_for(class_names, pred_class, pred_proba)
    result['explanation'] = explain(model, features, pred_class, class_names)
    print(json.dumps(result))


def result_for(class_names, pred_class, pred_proba):
    severity_label = class_names[pred_class]
    severity_score = {'Low': 2, 'Moderate': 5, 'High': 8}[severity_label]

    return {
        'predicted_severity': severity_label,
        'severity_score': severity_score,
        'confidence': round(float(max(pred_proba)), 2),
        'probabilities': {name: round(float(p), 2) for name, p in zip(class_names, pred_proba)},
        'risk_level': severity_label.lower(),
        'recommended_tens_intensity': min(100, severity_score * 12),
        'recommended_tens_frequency': 100 if severity_score > 5 else 50,
        'recommended_heat_temp': round(38 + min(4, severity_score * 0.4), 1),
        'recommendation': {
            'Low': 'Low pain expected. Continue current routine.',
            'Moderate': 'Moderate pain likely. Consider preemptive therapy.',
            'High': 'High pain predicted. Prepare TENS and heat therapy.'
        }[severity_label]
    }


# Neutral reference value per feature ("no symptom", an average day). Used only to explain a prediction.
REFERENCE = {
    'phase_encoded': 1,            # Follicular
    'day_from_last_menses': 13,
    'sleep_hours': 7,
    'stress': 0, 'fatigue': 0, 'cramps': 0, 'headaches': 0, 'bloating': 0, 'moodswing': 0, 'sleepissue': 0,   # "Not at all"
    'activity_encoded': 1,         # Moderate
    'mood_encoded': 2,             # Calm
    'BMI': 22,
    'age': 25,
}


def explain(model, features, pred_class, class_names):
    """Per-prediction explanation by perturbation: for each input, swap in its neutral reference value and measure how
    much the probability of the PREDICTED class changes. effect > 0: this input pushed toward the predicted result;
    effect < 0: it pulled away. Also returns the model's global feature importances (how much it relies on each input
    overall). This explains the raw model output, before any personal calibration."""
    base = float(model.predict_proba(features)[0][pred_class])
    factors = []
    for col in features.columns:
        value = features.iloc[0][col]
        ref = REFERENCE.get(col)
        if ref is None or float(value) == float(ref):
            continue
        probe = features.copy()
        probe.loc[probe.index[0], col] = ref
        effect = base - float(model.predict_proba(probe)[0][pred_class])
        factors.append({'feature': col, 'value': float(value), 'reference': float(ref), 'effect': round(effect, 3)})
    factors.sort(key=lambda f: -abs(f['effect']))
    importances = sorted(
        ({'feature': c, 'importance': round(float(i), 3)} for c, i in zip(features.columns, model.feature_importances_)),
        key=lambda f: -f['importance'])
    return {'method': 'perturbation', 'target': class_names[pred_class], 'probability': round(base, 3),
            'factors': factors, 'importances': importances}

if __name__ == '__main__':
    main()
