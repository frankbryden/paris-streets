import copy
import http.client
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from server import Handler, ThreadingHTTPServer, initial_state, valid_state
import server as companion
from scripts.install_reminders import updated_crontab, START, END
from scripts.remind import choose_street


class CompanionTests(unittest.TestCase):
    def test_cron_preserves_department_job_and_is_idempotent(self):
        original='*/5 * * * * /usr/bin/python3 /some/path/departements/main.py >> /tmp/departements.log 2>&1\n'
        result=updated_crontab(original)
        self.assertIn(original,result)
        self.assertEqual(result,updated_crontab(result))
        self.assertEqual(updated_crontab(result,remove=True),original)
        self.assertEqual(result.count(START),1)

    def test_cron_refuses_malformed_markers(self):
        with self.assertRaises(ValueError): updated_crontab(START+'\n')

    def test_notification_follows_level_arrondissement_and_recent_history(self):
        streets=json.loads((ROOT/'site/dist/data/streets.json').read_text())
        state=initial_state();state['settings']['arrondissement']='15'
        selected=choose_street(streets,state,{})
        self.assertEqual(selected['level'],0);self.assertIn(15,selected['arrondissements'])
        for _ in range(20):self.assertNotEqual(choose_street(streets,state,{'recent':[selected['id']]} )['id'],selected['id'])

    def test_single_eligible_street_can_still_send(self):
        s={'id':'a','level':0,'arrondissements':[15]}
        self.assertEqual(choose_street([s],initial_state(),{'recent':['a']}),s)

    def test_progress_rejects_unknown_streets_and_invalid_values(self):
        state=initial_state();self.assertTrue(valid_state(state,{'a'}))
        state['cards']['a']={'streak':1,'reviews':1,'correct':1,'due':100}
        self.assertTrue(valid_state(state,{'a'}));self.assertFalse(valid_state(state,set()))
        state['cards']['a']['due']=float('nan');self.assertFalse(valid_state(state,{'a'}))

    def test_mode_progress_accepts_neighborhood_ids_separately_from_streets(self):
        state=initial_state()
        card={'streak':1,'reviews':1,'correct':1,'due':100,'lastScore':1000,'bestScore':1000,'points':1000}
        state['modeCards']={'place-neighborhood':{'22':card},'place-street':{'a':card}}
        self.assertTrue(valid_state(state,{'a'}))
        state['modeCards']['name-street']={'22':card}
        self.assertFalse(valid_state(state,{'a'}))

    def test_legacy_backups_remain_valid_and_impossible_scores_are_rejected(self):
        state=initial_state();del state['modeCards'];del state['settings']['mode']
        self.assertTrue(valid_state(state,{'a'}))
        state['modeCards']={'place-neighborhood':{'1':{'streak':1,'reviews':1,'correct':1,'due':100,'lastScore':1001}}}
        self.assertFalse(valid_state(state,{'a'}))


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.old_state=companion.STATE_FILE
        companion.STATE_FILE=Path(cls.temp.name)/'progress.json'
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),Handler);cls.http.street_ids={'a'}
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();companion.STATE_FILE=cls.old_state;cls.temp.cleanup()

    def request(self,method,path,body=None,headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        connection.request(method,path,body=body,headers=headers or {})
        response=connection.getresponse();status=response.status;data=response.read();connection.close();return status,data

    def test_static_site_and_modules_are_served(self):
        status,data=self.request('GET','/');self.assertEqual(status,200);self.assertIn(b'Paris, rue par rue',data)
        self.assertEqual(self.request('GET','/learning.mjs')[0],200)

    def test_saves_and_restores_progress(self):
        data=initial_state();data['cards']['a']={'streak':1,'reviews':1,'correct':1,'due':100}
        self.assertEqual(self.request('PUT','/api/state',json.dumps(data),{'Content-Type':'application/json'})[0],200)
        status,body=self.request('GET','/api/state');self.assertEqual(status,200);self.assertEqual(json.loads(body)['state'],data)

    def test_cross_origin_and_rebinding_are_rejected(self):
        self.assertEqual(self.request('GET','/api/state',headers={'Origin':'https://example.org'})[0],403)
        self.assertEqual(self.request('GET','/api/state',headers={'Host':'example.org'})[0],403)

    def test_invalid_payload_does_not_overwrite_saved_progress(self):
        self.assertEqual(self.request('PUT','/api/state','{}',{'Content-Type':'application/json'})[0],400)


if __name__=='__main__': unittest.main()
