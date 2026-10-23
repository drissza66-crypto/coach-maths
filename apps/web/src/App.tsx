import { Navigate, Route, Routes } from 'react-router-dom';
import { homePath, useAuth } from './auth/AuthContext';
import { Layout, RequireRole } from './components/Layout';
import { Accueil } from './pages/Accueil';
import { Introuvable } from './pages/Introuvable';
import { MesDonnees } from './pages/MesDonnees';
import { AccueilApprenti } from './pages/apprenti/AccueilApprenti';
import { ChangerPin } from './pages/apprenti/ChangerPin';
import { ConnexionApprenti } from './pages/apprenti/ConnexionApprenti';
import { ClasseDetail } from './pages/formateur/ClasseDetail';
import { Classes } from './pages/formateur/Classes';
import { ConnexionFormateur } from './pages/formateur/ConnexionFormateur';
import { Verification } from './pages/formateur/Verification';

export function App() {
  const { me, loading } = useAuth();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={loading ? <p role="status">Chargement…</p> : me ? <Navigate to={homePath(me)} replace /> : <Accueil />}
        />
        <Route path="apprenti/connexion" element={<ConnexionApprenti />} />
        <Route path="formateur/connexion" element={<ConnexionFormateur />} />
        <Route path="formateur/verification" element={<Verification />} />

        <Route element={<RequireRole roles={['apprenti']} />}>
          <Route path="apprenti" element={<AccueilApprenti />} />
          <Route path="apprenti/code" element={<ChangerPin />} />
        </Route>

        <Route element={<RequireRole roles={['formateur', 'admin']} />}>
          <Route path="formateur" element={<Classes />} />
          <Route path="formateur/classes/:id" element={<ClasseDetail />} />
        </Route>

        <Route element={<RequireRole roles={['apprenti', 'formateur', 'admin']} />}>
          <Route path="mes-donnees" element={<MesDonnees />} />
        </Route>

        <Route path="*" element={<Introuvable />} />
      </Route>
    </Routes>
  );
}
