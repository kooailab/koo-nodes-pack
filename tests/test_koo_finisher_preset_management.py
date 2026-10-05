"""Independent preset files and fresh-process rediscovery regressions."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from test_koo_finisher_features import presets


class MultiplePresetTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        stub=patch.dict(sys.modules,{"folder_paths":SimpleNamespace(get_user_directory=lambda:str(self.root))})
        stub.start();self.addCleanup(stub.stop)
        self.ids={name:presets.save_preset(name,{"exposure":ev})[0] for name,ev in [('A',.1),('B',.2),('C',.3)]}

    def test_three_files_independent_and_save_targets_only_a(self):
        directory=presets.preset_directory()
        self.assertEqual(len(list(directory.glob('*.json'))),3)
        self.assertEqual({p['name'] for p in presets.list_presets()},{'A','B','C'})
        before={name:(directory/f'{identifier}.json').read_bytes() for name,identifier in self.ids.items()}
        presets.save_preset('A',{'exposure':.9},self.ids['A'])
        self.assertEqual(presets.load_preset(self.ids['A'])['settings']['exposure'],.9)
        for name in ['B','C']:
            self.assertEqual((directory/f'{self.ids[name]}.json').read_bytes(),before[name])

    def test_save_as_duplicate_never_overwrites_and_keeps_unicode(self):
        old=presets.load_preset(self.ids['A'])
        identifier,preset=presets.save_preset('A',{'exposure':1})
        self.assertNotEqual(identifier,self.ids['A']);self.assertEqual(preset['name'],'A (2)')
        self.assertEqual(presets.load_preset(self.ids['A']),old)
        identifier,preset=presets.save_preset('柔らかい Éditorial',{})
        self.assertEqual(presets.load_preset(identifier)['name'],preset['name'])

    def test_rename_and_delete_preserve_other_files(self):
        b=presets.load_preset(self.ids['B'])
        presets.rename_preset(self.ids['B'],'B New')
        self.assertEqual(presets.load_preset(self.ids['B'])['settings'],b['settings'])
        self.assertEqual({p['name'] for p in presets.list_presets()},{'A','B New','C'})
        self.assertEqual(len(list(presets.preset_directory().glob('*.json'))),3)
        presets.delete_preset(self.ids['A'])
        self.assertEqual({p['name'] for p in presets.list_presets()},{'B New','C'})
        self.assertFalse((presets.preset_directory()/f'{self.ids["A"]}.json').exists())

    def test_multiple_imports_and_duplicate_names_coexist(self):
        text=json.dumps({'schema_version':2,'name':'Imported','settings':{'exposure':.4}})
        first,p1=presets.import_preset(text);second,p2=presets.import_preset(text)
        self.assertNotEqual(first,second)
        self.assertEqual(p1['name'],'Imported');self.assertEqual(p2['name'],'Imported (2)')
        self.assertEqual(len(presets.list_presets()),5)

    def test_fresh_module_rediscovers_files_after_restart(self):
        name=presets.__package__+'.preset_restart_test'
        spec=importlib.util.spec_from_file_location(name,presets.__file__)
        fresh=importlib.util.module_from_spec(spec);spec.loader.exec_module(fresh)
        self.assertEqual(fresh.list_presets(),presets.list_presets())
        for name,identifier in self.ids.items():
            self.assertEqual(fresh.load_preset(identifier),presets.load_preset(identifier))
        for identifier in self.ids.values():fresh.delete_preset(identifier)
        self.assertEqual(fresh.list_presets(),[])


if __name__=='__main__':unittest.main()
