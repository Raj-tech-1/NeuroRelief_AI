import { useState, useEffect } from 'react'
import { getDoctors } from '../../services/api'

const BASE_URL = 'http://localhost:8000/api'
function getToken() {
  const user = localStorage.getItem('neurorelief_user')
  if (!user) return null
  try { return JSON.parse(user).token } catch { return null }
}

export default function DoctorConnect() {
  const [doctors, setDoctors] = useState([])
  const [booking, setBooking] = useState(null)
  const [selectedDay, setSelectedDay] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [confirmed, setConfirmed] = useState(null)
  const [pastBookings, setPastBookings] = useState([])

  useEffect(() => {
    getDoctors().then(setDoctors)
    // Load past bookings
    fetch(`${BASE_URL}/doctors/bookings`, { headers: { 'Authorization': `Bearer ${getToken()}` } })
      .then(r => r.json()).then(data => setPastBookings(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const timeSlots = ['9:00 AM', '10:00 AM', '11:00 AM', '2:00 PM', '3:00 PM', '4:00 PM']

  function handleBook(doc) {
    setBooking(doc)
    setSelectedDay('')
    setSelectedTime('')
    setConfirmed(null)
  }

  async function handleConfirm() {
    if (!selectedDay || !selectedTime) return
    try {
      const res = await fetch(`${BASE_URL}/doctors/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
        body: JSON.stringify({
          doctor_id: booking.id, doctor_name: booking.name,
          specialty: booking.specialty, day: selectedDay,
          time: selectedTime, price: booking.price
        })
      })
      await res.json()
    } catch {}

    setConfirmed({ doctor: booking.name, specialty: booking.specialty, day: selectedDay, time: selectedTime, price: booking.price })
    setPastBookings(prev => [{ doctor_name: booking.name, specialty: booking.specialty, day: selectedDay, time: selectedTime, price: booking.price, status: 'confirmed' }, ...prev])
    setBooking(null)
  }

  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-bold text-brand-800 mb-1">Doctor Connect</h3>
      <p className="text-sm text-gray-500 mb-4">Connect with specialized healthcare providers for personalized care</p>

      {confirmed && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
          <p className="font-semibold text-green-800">Appointment Confirmed!</p>
          <p className="text-sm text-green-700 mt-1">
            {confirmed.doctor} ({confirmed.specialty}) • {confirmed.day} at {confirmed.time} • ₹{confirmed.price}
          </p>
          <button onClick={() => setConfirmed(null)} className="text-xs text-green-600 underline mt-2">Dismiss</button>
        </div>
      )}

      {/* Past bookings */}
      {pastBookings.length > 0 && !confirmed && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
          <p className="font-semibold text-blue-800 mb-2">Your Appointments</p>
          {pastBookings.slice(0, 3).map((b, i) => (
            <div key={i} className="flex justify-between items-center text-sm mb-1">
              <span className="text-blue-700">{b.doctor_name} • {b.day} at {b.time}</span>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">{b.status || 'confirmed'}</span>
            </div>
          ))}
        </div>
      )}

      {booking && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-5 mb-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="font-bold text-brand-800">Book with {booking.name}</p>
              <p className="text-sm text-gray-500">{booking.specialty} • ₹{booking.price}/consultation</p>
            </div>
            <button onClick={() => setBooking(null)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
          </div>
          <p className="text-sm font-medium text-gray-700 mb-2">Select day</p>
          <div className="flex gap-2 mb-3 flex-wrap">
            {booking.days.map(day => (
              <button key={day} onClick={() => setSelectedDay(day)}
                className={`px-4 py-2 rounded-lg text-sm border transition ${selectedDay === day ? 'bg-brand-500 text-white border-brand-500' : 'border-gray-200 hover:bg-gray-50'}`}>{day}</button>
            ))}
          </div>
          <p className="text-sm font-medium text-gray-700 mb-2">Select time</p>
          <div className="flex gap-2 mb-4 flex-wrap">
            {timeSlots.map(time => (
              <button key={time} onClick={() => setSelectedTime(time)}
                className={`px-3 py-2 rounded-lg text-sm border transition ${selectedTime === time ? 'bg-brand-500 text-white border-brand-500' : 'border-gray-200 hover:bg-gray-50'}`}>{time}</button>
            ))}
          </div>
          <button onClick={handleConfirm} disabled={!selectedDay || !selectedTime}
            className="w-full py-2.5 bg-brand-500 text-white rounded-lg font-medium hover:bg-brand-600 disabled:opacity-40">Confirm Booking</button>
        </div>
      )}

      <h4 className="font-semibold text-gray-900 mb-3">Available Specialists</h4>
      <div className="space-y-4 mb-6">
        {doctors.map(doc => (
          <div key={doc.id} className="border border-gray-100 rounded-xl p-5">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold text-brand-800">{doc.name}</p>
                <p className="text-sm text-brand-600">{doc.specialty}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-yellow-500 text-sm">{'★'.repeat(Math.round(doc.rating))}</span>
                  <span className="text-xs text-gray-500">({doc.rating})</span>
                  <span className="text-xs text-gray-400">• {doc.experience}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold text-brand-800">₹{doc.price}</p>
                <p className="text-xs text-gray-500">per consultation</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mt-3">{doc.description}</p>
            <div className="flex items-center justify-between mt-3">
              <div className="flex gap-2">
                {doc.days.map(day => (
                  <span key={day} className="text-xs text-brand-600 bg-pink-50 px-2 py-1 rounded">{day}</span>
                ))}
              </div>
              <div className="flex gap-2">
                {doc.phone && (
                  <a href={`tel:${doc.phone}`} className="px-4 py-2 border border-green-500 text-green-700 text-sm rounded-lg font-medium hover:bg-green-50 flex items-center gap-1">📞 Call</a>
                )}
                <button onClick={() => handleBook(doc)} className="px-5 py-2 bg-brand-600 text-white text-sm rounded-lg font-medium hover:bg-brand-700">Book Now</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
        <h4 className="font-semibold text-gray-900">Emergency Support</h4>
        <p className="text-sm text-gray-600 mt-1">For urgent medical concerns, please seek immediate medical attention or call emergency services.</p>
        <div className="flex gap-3 mt-3">
          <a href="tel:112" className="px-4 py-2 bg-red-700 text-white text-sm rounded-lg font-medium inline-block">Call Emergency: 112</a>
          <a href="https://www.google.com/maps/search/hospitals+near+me" target="_blank" rel="noopener noreferrer" className="px-4 py-2 border border-yellow-400 text-yellow-800 text-sm rounded-lg font-medium hover:bg-yellow-100 inline-block">Find Nearby Hospital</a>
        </div>
      </div>
    </div>
  )
}
