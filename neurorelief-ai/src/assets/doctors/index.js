// Local photos for the five FICTIONAL demo clinicians. Mapping is by display name (slug), set by the project owner:
// attachment order 1-5 = Ananya Rao, Priya Sharma, Kavitha Nair, Meera Iyer, Nisha Desai.
import ananyaRao from './ananya-rao.jpg'
import priyaSharma from './priya-sharma.jpg'
import kavithaNair from './kavitha-nair.jpg'
import meeraIyer from './meera-iyer.jpg'
import nishaDesai from './nisha-desai.jpg'

const PHOTOS = { ananyarao: ananyaRao, priyasharma: priyaSharma, kavithanair: kavithaNair, meeraiyer: meeraIyer, nishadesai: nishaDesai }

// 'Dr. Ananya Rao' -> 'ananyarao' (also the key suffix of doctorDesc.* translations)
export const doctorSlug = name => String(name || '').toLowerCase().replace(/^dr\.?\s+/, '').replace(/[^a-z]/g, '')
export const doctorPhoto = name => PHOTOS[doctorSlug(name)] || null
