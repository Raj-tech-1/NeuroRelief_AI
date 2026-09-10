"""
Prediction script — reads input from a JSON file passed as argument.
Usage: python predict.py input_file.json
"""
import sys
import json
import pickle
import pandas as pd

def main():
    input_file = sys.argv[1]
    
    with open(input_file, 'r') as f:
        data = json.load(f)
    
    input_data = data['features']
    model_path = data['model_path']

    with open(model_path, 'rb') as f:
        model_data = pickle.load(f)

    model = model_data['model']
    phase_map = model_data['phase_map']
    activity_map = model_data['activity_map']
    mood_map = model_data['mood_map']
    class_names = model_data['class_names']

    phase_encoded = phase_map.get(input_data.get('phase', 'Follicular'), 1)
    activity_encoded = activity_map.get(input_data.get('activity_level', 'Moderate'), 1)
    mood_encoded = mood_map.get(input_data.get('mood', 'Calm'), 2)

    features = pd.DataFrame([{
        'phase_encoded': phase_encoded,
        'day_from_last_menses': input_data.get('day_from_last_menses', 14),
        'sleep_hours': input_data.get('sleep_hours', 7),
        'stress': input_data.get('stress', 3),
        'fatigue': input_data.get('fatigue', 2),
        'cramps': input_data.get('cramps', 2),
        'headaches': input_data.get('headaches', 1),
        'bloating': input_data.get('bloating', 1),
        'moodswing': input_data.get('moodswing', 1),
        'sleepissue': input_data.get('sleepissue', 1),
        'activity_encoded': activity_encoded,
        'mood_encoded': mood_encoded,
        'BMI': input_data.get('bmi', 22),
        'age': input_data.get('age', 25),
    }])

    pred_class = model.predict(features)[0]
    pred_proba = model.predict_proba(features)[0]
    severity_label = class_names[pred_class]
    severity_score = {'Low': 2, 'Moderate': 5, 'High': 8}[severity_label]

    result = {
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
    print(json.dumps(result))

if __name__ == '__main__':
    main()
